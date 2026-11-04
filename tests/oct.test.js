import { test, assert, close } from './harness.js';
import { Source, glassAt, glassBeta, TWO_PI } from '../oct/source.js';
import { makeStack, plateStack, bursts, makeScene, mulberry32, fresnel } from '../oct/sample.js';
import { detectorTrace, demodulate, peaks, peakWidth, dcLevel } from '../oct/tdoct.js';
import { makeSpectrometer, cameraSpectrum, fdAScan, positiveHalf, fold } from '../oct/fdoct.js';
import { BScan, Volume, column, sceneBeam, ridge, fitLine, repeatPlan, averagedContrast, speckleRegion, speckleContrast, regionWidths } from '../oct/scan.js';

/** The A-scan of a set of bursts by the time-domain route: trace, then demodulation. */
function tdAScan(B, src, Dmax, opts = {}) {
  const h = src.lam0 / 8, N = Math.ceil(Dmax / h);
  const tr = detectorTrace(B, src, 0, h, N, opts);
  return { A: demodulate(tr, src), h, tr };
}

// ------------------------------------------------------------------------- the source

test('the coherence length ℓ_c = (2 ln 2/π) λ₀²/Δλ, and γ(Δ) is the Fourier transform of the spectrum', () => {
  const out = [];
  for (const [lam, fw] of [[840, 50], [840, 10], [840, 150], [1300, 50]]) {
    const s = new Source(lam, fw), lc = ((2 * Math.LN2) / Math.PI) * (lam / 1000) ** 2 / (fw / 1000);
    close(s.lc, lc, 1e-12, `${lam}/${fw}`);
    // The envelope is 1/2 at Δ = ±ℓ_c: half height at d = ±ℓ_c/2 of mirror travel.
    close(s.envelope(s.lc), 0.5, 1e-12, 'half height'); close(s.envelope(-s.lc), 0.5, 1e-12, 'half height');
    out.push(`${lam}/${fw} nm: ${s.lc.toFixed(3)} μm`);
  }
  // γ(Δ) against ∫ S(k) e^{ikΔ} dk by the midpoint rule.
  const s = new Source(840, 50), g = [0, 0];
  let worst = 0;
  for (const D of [0, 1.3, 4.7, 9.1, 15]) {
    let re = 0, im = 0;
    const dk = s.sigk / 400;
    for (let k = s.k0 - 9 * s.sigk; k < s.k0 + 9 * s.sigk; k += dk) { const S = s.spectrum(k + dk / 2) * dk; re += S * Math.cos((k + dk / 2) * D); im += S * Math.sin((k + dk / 2) * D); }
    s.gamma(D, g);
    worst = Math.max(worst, Math.abs(g[0] - re), Math.abs(g[1] - im));
  }
  assert(worst < 1e-9, `γ against quadrature: ${worst}`);
  return `${out.join('; ')}; γ against quadrature within ${worst.toExponential(1)}`;
});

test('dispersion: a chirped burst is |q| = √(1 + 4β²σ_k⁴) wider; BK7\'s GVD is 44.65 fs²/mm at 800 nm', () => {
  close(glassAt(0.8).gvd, 44.65, 0.02, 'GVD at 800 nm (Schott N-BK7)');
  close(glassAt(1.3).gvd, 2.08, 0.05, 'GVD at 1300 nm');
  const out = [];
  for (const [lam, fw, L] of [[840, 150, 2000], [840, 50, 2000], [1300, 50, 5000]]) {
    const s = new Source(lam, fw), beta = glassBeta(s, L), B = bursts(plateStack({}), 50, beta);
    // γ with dispersion against quadrature, at a few points.
    const g = [0, 0];
    for (const u of [0, 3, 8]) {
      let re = 0, im = 0;
      const dk = s.sigk / 300;
      for (let k = s.k0 - 9 * s.sigk; k < s.k0 + 9 * s.sigk; k += dk) { const kk = k + dk / 2, S = s.spectrum(kk) * dk, ph = kk * u + beta * (kk - s.k0) ** 2; re += S * Math.cos(ph); im += S * Math.sin(ph); }
      s.gamma(u, g, beta);
      assert(Math.abs(g[0] - re) < 1e-8 && Math.abs(g[1] - im) < 1e-8, `chirped γ at ${u}: ${g} against ${re}, ${im}`);
    }
    const { A, h } = tdAScan(B, s, 200), pk = peaks(A, 0, h, 0.01)[0];
    const fwhm = peakWidth(A, pk.j, h) / 2, want = s.lc * s.spread(beta);
    close(fwhm, want, 0.005 * want, `${lam}/${fw} with ${L / 1000} mm`);
    close(pk.a, 0.2 / Math.sqrt(s.spread(beta)), 0.002, 'lowered by |q|^−1/2');
    out.push(`${lam}/${fw}, ${L / 1000} mm: ${fwhm.toFixed(3)} μm (ℓ_c ${s.lc.toFixed(2)} × ${s.spread(beta).toFixed(3)})`);
  }
  return out.join('; ');
});

// ------------------------------------------------------------------------- time domain

test('time domain: each burst is centred at Δ = 2(offset + n z), ℓ_c wide in mirror travel, as high as the layer reflects', () => {
  const src = new Source(840, 50), st = makeStack('slide'), B = bursts(st, 20);
  close(B[0].a, fresnel(1, 1.52), 1e-12, 'front face'); close(B[1].a, fresnel(1.52, 1) * (1 - fresnel(1, 1.52) ** 2), 1e-12, 'back face, through the front twice');
  const { A, h } = tdAScan(B, src, 620), pk = peaks(A, 0, h, 0.05).sort((p, q) => p.D - q.D);
  assert(pk.length === 2, `${pk.length} peaks`);
  close(pk[0].D, 2 * 20, h, 'front at 2 × 20 μm'); close(pk[1].D, 2 * (20 + 1.52 * 170), h, 'back at 2(20 + 1.52 × 170) μm');
  for (const [i, p] of pk.entries()) {
    close(peakWidth(A, p.j, h) / 2, src.lc, 0.005 * src.lc, `burst ${i} width`);
    close(p.a, Math.abs(B[i].a), 0.003, `burst ${i} height`);
  }
  return `peaks at d = ${pk.map((p) => (p.D / 2).toFixed(3)).join(' and ')} μm, ${(peakWidth(A, pk[0].j, h) / 2).toFixed(3)} μm wide (ℓ_c = ${src.lc.toFixed(3)})`;
});

test('time domain: the DC level, and the demodulated envelope against the exact one', () => {
  const src = new Source(840, 50), B = bursts(makeStack('film'), 20);
  const { A, tr } = tdAScan(B, src, 500);
  // DC: 1 + Σ a² plus the layers interfering with each other (negligible when they are far apart).
  close(tr.dc, 1 + B.reduce((s, b) => s + b.a * b.a, 0), 1e-9, 'DC');
  close(dcLevel(B, src), tr.dc, 1e-15, 'DC');
  let worst = 0;
  for (let j = 0; j < A.length; j++) worst = Math.max(worst, Math.abs(A[j] - Math.hypot(tr.re[j], tr.im[j])));
  assert(worst < 2e-4, `demodulation error ${worst}`);
  return `the envelope from the band-passed trace is within ${worst.toExponential(1)} of the exact |E|`;
});

test('time domain: the noise floor is the σ asked for (rms √2 σ of the envelope)', () => {
  const src = new Source(840, 50), h = src.lam0 / 8, N = 16000, out = [];
  for (const sigma of [0.003, 0.03]) {
    const tr = detectorTrace([], src, 0, h, N, { noise: sigma, rng: mulberry32(7) }), A = demodulate(tr, src);
    let s = 0, n = 0;
    for (let j = 1000; j < N - 1000; j++) { s += A[j] * A[j]; n++; }
    close(Math.sqrt(s / n), Math.SQRT2 * sigma, 0.05 * Math.SQRT2 * sigma, `σ = ${sigma}`);
    out.push(`σ = ${sigma}: rms ${Math.sqrt(s / n).toFixed(5)} (√2 σ = ${(Math.SQRT2 * sigma).toFixed(5)})`);
  }
  return out.join('; ');
});

test('resolution: two equal layers in step merge below 1/σ_k = 0.85 ℓ_c; out of step they always dip', () => {
  const src = new Source(840, 50), half = src.lam0 / 2, sep = 1 / src.sigk;   // in mirror travel: two Gaussians of SD 1/(2σ_k)
  const count = (s) => {
    const B = [{ D: 100, a: 0.2 }, { D: 100 + 2 * s, a: 0.2 }];
    const { A, h } = tdAScan(B, src, 100 + 2 * s + 100);
    return peaks(A, 0, h, 0.02).filter((p) => p.a > 0.05).length;
  };
  // In step: separations that are whole numbers of half-wavelengths, just below and just above 1/σ_k.
  const below = Math.floor((0.97 * sep) / half) * half, above = Math.ceil((1.03 * sep) / half) * half;
  assert(count(below) === 1 && count(above) === 2, `in step: ${count(below)} peaks at ${below.toFixed(3)}, ${count(above)} at ${above.toFixed(3)} (1/σ_k = ${sep.toFixed(3)})`);
  // Out of step (an odd number of quarter-waves), even well inside ℓ_c: two peaks.
  const odd = (Math.round(0.4 * sep / half) + 0.5) * half;
  assert(count(odd) === 2, `out of step at ${odd.toFixed(3)}: ${count(odd)} peaks`);
  // And the demo's pair (the second surface slightly weaker): always two above 5.5 μm.
  for (let g = 5.5; g <= 7; g += 0.05) {
    const B = bursts(makeStack('pair', { gap: g }), 20), { A, h } = tdAScan(B, src, 100);
    assert(peaks(A, 0, h, 0.02).filter((p) => p.a > 0.05).length === 2, `gap ${g}`);
  }
  return `in step: one peak at ${below.toFixed(2)} μm, two at ${above.toFixed(2)} (1/σ_k = ${sep.toFixed(2)} μm = ${(sep / src.lc).toFixed(3)} ℓ_c); out of step: two at ${odd.toFixed(2)} μm`;
});

// ------------------------------------------------------------------------- Fourier domain

test('Fourier domain: the A-scan from the spectrum agrees with the time-domain one', () => {
  const src = new Source(840, 50), B = bursts(makeStack('retina'), 20), spec = makeSpectrometer(src, 1024);
  const fd = positiveHalf(fdAScan(cameraSpectrum(B, src, spec), spec, { subtract: true, pad: 4 }));
  const { A, h } = tdAScan(B, src, 1100);
  const pf = peaks(fd.A, 0, fd.h, 0.005).filter((p) => p.D > 5).sort((p, q) => p.D - q.D);
  const pt = peaks(A, 0, h, 0.005).sort((p, q) => p.D - q.D);
  // The FD transform also has the autocorrelation peaks; match each TD peak to the nearest FD one.
  let worstD = 0, worstA = 0;
  for (const p of pt) {
    const q = pf.reduce((a, b) => (Math.abs(b.D - p.D) < Math.abs(a.D - p.D) ? b : a));
    worstD = Math.max(worstD, Math.abs(q.D - p.D));
    worstA = Math.max(worstA, Math.abs(q.a / spec.rolloff(q.D) - p.a) / p.a);
  }
  assert(pt.length === 9 && worstD < 0.5 && worstA < 0.01, `${pt.length} TD peaks; positions within ${worstD}, heights (with the fall-off) within ${worstA}`);
  return `9 layers: positions within ${worstD.toFixed(3)} μm of Δ, heights within ${(100 * worstA).toFixed(2)}% once the fall-off is taken out`;
});

test('Fourier domain: the depth range z_max = π/(2n δk); beyond it a layer folds to 2Δ_max − Δ; behind zero path it is mirrored', () => {
  const src = new Source(840, 50), out = [];
  for (const N of [256, 1024]) {
    const spec = makeSpectrometer(src, N);
    close(spec.zMax(1), Math.PI / (2 * spec.dk), 1e-9, 'z_max');
    close(spec.zMax(1), (N * src.lam0 * src.lam0) / (12 * src.fwhmNm / 1000), 1e-6, 'N λ²/(12 Δλ) for a camera three bandwidths wide');
    close(spec.zMax(1.38), spec.zMax(1) / 1.38, 1e-9, 'in tissue');
    const D = 2 * 1.3 * spec.zMax(1), cam = cameraSpectrum([{ D, a: 0.2 }], src, spec);
    const fd = positiveHalf(fdAScan(cam, spec, { subtract: true })), p = peaks(fd.A, 0, fd.h, 0.005)[0];
    close(p.D, 2 * spec.DMax - D, fd.h, `N = ${N}: folded`);
    close(fold(D / 2, spec.DMax / 2), p.D / 2, fd.h, 'fold()');
    // A layer before zero path, at −Δ, shows at +Δ, as high.
    const m = positiveHalf(fdAScan(cameraSpectrum([{ D: -300, a: 0.2 }], src, spec), spec, { subtract: true })), q = peaks(m.A, 0, m.h, 0.005)[0];
    close(q.D, 300, m.h, 'mirrored'); close(q.a, 0.2 * spec.rolloff(300), 0.002, 'mirror image as high');
    out.push(`N = ${N}: z_max = ${spec.zMax(1).toFixed(1)} μm; a layer at Δ = ${D.toFixed(1)} shows at ${p.D.toFixed(1)}`);
  }
  close(fold(-37, 100), 37, 1e-12, 'fold(−d)'); close(fold(163, 100), 37, 1e-12, 'fold(2d_m − d)'); close(fold(237, 100), 37, 1e-12, 'fold(2d_m + d)');
  return out.join('; ');
});

test('Fourier domain: the fall-off, sinc(Δδk/2) e^{−(Δδk)²/16 ln 2}, as measured from the transform', () => {
  const src = new Source(840, 50), spec = makeSpectrometer(src, 512), out = [];
  for (const f of [0.2, 0.5, 0.8]) {
    const D = f * spec.DMax, fd = positiveHalf(fdAScan(cameraSpectrum([{ D, a: 0.2 }], src, spec), spec, { subtract: true, pad: 8 }));
    const p = peaks(fd.A, 0, fd.h, 0.001)[0];
    close(p.a / 0.2, spec.rolloff(D), 0.005, `at ${f} of the range`);
    out.push(`${f}: ${(p.a / 0.2).toFixed(4)} (${spec.rolloff(D).toFixed(4)})`);
  }
  return out.join('; ');
});

// ------------------------------------------------------------------------- scanning

test('B-scan: a tilted layer comes out tilted; glass looks n times thicker', () => {
  const src = new Source(840, 50), out = [];
  for (const tilt of [3, -7]) {
    const sc = makeScene('plate', { tilt }), bs = new BScan(sc, src, { nx: 256 }), beam = sceneBeam(sc, src, 0.04, 200);
    bs.measureAll({ beam, speckle: false });
    // The front face: the brightest point in each column above the paint.
    const top = (x) => sc.zTop(x, 0), r = ridge(bs).filter((p) => Math.abs(p.d - top(p.x)) < 20), f = fitLine(r);
    close((Math.atan(f.slope) * 180) / Math.PI, tilt, 0.02, `tilt ${tilt}°`);
    // At x = 0 the paint's surface is 200 μm of glass below the front: n × 200 = 300 μm in the image.
    const ix = bs.nx / 2, A = bs.img.subarray(ix * bs.nz, (ix + 1) * bs.nz);
    let bm = 0, best = 0;
    for (let m = 0; m < bs.nz; m++) { const d = m * bs.hd; if (d > top(bs.x(ix)) + 200 && d < top(bs.x(ix)) + 400 && A[m] > best) { best = A[m]; bm = m; } }
    // (The scene's bands are as thick as they are measured straight down.)
    close(bm * bs.hd - top(bs.x(ix)), 1.5 * 200, 2 * bs.hd, 'the paint, n t below the front');
    out.push(`${tilt}°: fitted ${((Math.atan(f.slope) * 180) / Math.PI).toFixed(3)}°, paint ${(bm * bs.hd - top(bs.x(ix))).toFixed(1)} μm below the front`);
  }
  return out.join('; ');
});

test('B-scan: a bead\'s image is 1.18 w(z) wide across and ℓ_c/n deep, whatever the NA', () => {
  const src = new Source(840, 50), sc = makeScene('beads'), out = [];
  for (const NA of [0.02, 0.1]) {
    const beam = sceneBeam(sc, src, NA, 300), bs = new BScan(sc, src, { nx: 512 });
    for (let ix = 200; ix < 312; ix++) bs.measure(ix, { beam, speckle: true });
    const row = new Float64Array(bs.nx), ic = Math.round(300 / bs.pitch - 0.5);
    for (const z of [100, 300, 600]) {
      const d = sc.zToD(sc.profile(0, 0), z), m0 = Math.round(d / bs.hd);
      let best = 0, mb = m0, jb = ic;
      for (let q = m0 - 3; q <= m0 + 3; q++) for (let j = ic - 3; j <= ic + 3; j++) if (bs.img[j * bs.nz + q] > best) { best = bs.img[j * bs.nz + q]; mb = q; jb = j; }
      for (let ix = 0; ix < bs.nx; ix++) row[ix] = bs.img[ix * bs.nz + mb];
      const across = peakWidth(row, jb, bs.pitch), deep = peakWidth(bs.img.subarray(jb * bs.nz, (jb + 1) * bs.nz), mb, bs.hd) / sc.nView;
      const want = Math.sqrt(2 * Math.LN2) * beam.width(z);
      assert(Math.abs(across - want) < Math.max(0.05 * want, 0.6 * bs.pitch), `NA ${NA}, z ${z}: ${across} across, want ${want}`);
      close(deep, src.lc / sc.nView, 0.03 * src.lc / sc.nView, `NA ${NA}, z ${z}: depth`);
      out.push(`NA ${NA}, z ${z}: ${across.toFixed(1)} (${want.toFixed(1)}) × ${deep.toFixed(2)} μm`);
    }
  }
  return `${out.join('; ')}; ℓ_c/n = ${(src.lc / sc.nView).toFixed(2)} μm`;
});

test('B-scan: speckle averages to the speckle-free picture, with a contrast near 1', () => {
  const src = new Source(840, 50), sc = makeScene('retina', { lesion: false }), beam = sceneBeam(sc, src, 0.03, 260);
  const nz = 384, hd = (sc.nView * sc.depth) / nz, a = new Float64Array(nz), m = new Float64Array(nz);
  let s = 0, s2 = 0, n = 0;
  for (let i = 0; i < 60; i++) {
    const x = -1400 + i * 47;
    column(sc, src, x, 0, hd, nz, a, { beam, speckle: true });
    column(sc, src, x, 0, hd, nz, m, { beam, speckle: false });
    const prof = sc.profile(x, 0);
    for (let q = 0; q < nz; q++) {
      const d = q * hd;
      if (!((d > prof.dtops[5] + 8 && d < prof.dtops[6] - 8) || (d > prof.dtops[8] + 15 && d < prof.dtops[8] + 200))) continue;
      const r = (a[q] * a[q]) / (m[q] * m[q]);
      s += r; s2 += r * r; n++;
    }
  }
  const mean = s / n, contrast = Math.sqrt(s2 / n - mean * mean) / mean;
  close(mean, 1, 0.06, 'mean of speckle over the mean picture');
  assert(contrast > 0.9 && contrast < 1.4, `speckle contrast ${contrast}`);
  return `⟨I/I_mean⟩ = ${mean.toFixed(3)}, contrast ${contrast.toFixed(3)} over ${n} samples (fully developed speckle: 1)`;
});

test('scenes: attenuation e^{−∫μ dz}, optical depth n₀z₀ + Σ nᵢtᵢ, and the volume\'s three slices agree', () => {
  const sc = makeScene('retina'), p = sc.profile(800, 100);
  let d = sc.n0 * p.tops[0], att = 0;
  for (let i = 0; i < sc.nb; i++) { d += sc.bands[i].n * (p.tops[i + 1] - p.tops[i]); att += (sc.bands[i].mu || 0) * (p.tops[i + 1] - p.tops[i]); close(p.dtops[i + 1], d, 1e-9, `band ${i}`); }
  close(sc.through(p, p.tops[sc.nb]), Math.exp(-att), 1e-12, 'through');
  close(sc.zToD(p, p.tops[3] + 10), p.dtops[3] + 1.38 * 10, 1e-9, 'zToD');
  const src = new Source(840, 50), v = new Volume(sc, src, { nx: 8, ny: 6, nz: 64 }), beam = sceneBeam(sc, src, 0.03, 260);
  v.measureAll({ beam, speckle: true });
  const xy = v.sliceXY(20), yz = v.sliceYZ(5);
  for (let iy = 0; iy < 6; iy++) for (let ix = 0; ix < 8; ix++) {
    const a = v.sliceXZ(iy)[ix * 64 + 20];
    assert(a === xy[iy * 8 + ix], 'xz against xy');
    if (ix === 5) assert(a === yz[iy * 64 + 20], 'xz against yz');
  }
  return `optical depth of the retina's bottom at (0.8, 0.1) mm: ${p.dtops[sc.nb].toFixed(1)} μm, amplitude left ${sc.through(p, p.tops[sc.nb]).toFixed(3)}`;
});

// ------------------------------------------------------------------------- averaging B-scans

/** A retina's B-scan (no cyst) measured on every eighth column, and its speckle-free picture there. */
function speckleBench(noise = 0) {
  const src = new Source(840, 50), sc = makeScene('retina', { lesion: false }), beam = sceneBeam(sc, src, 0.03, 260), bs = new BScan(sc, src);
  const cols = [];
  for (let ix = 3; ix < bs.nx; ix += 8) cols.push(ix);
  const ref = new Float32Array(bs.nx * bs.nz);
  for (const ix of cols) column(sc, src, bs.x(ix), 0, bs.hd, bs.nz, ref.subarray(ix * bs.nz, (ix + 1) * bs.nz), { beam, speckle: false, quick: true });
  const o = { beam, speckle: true, noise };
  const measure = (N, how, step = 0) => {
    bs.setAverage(N, how, step);
    for (let k = 0; k < N; k++) for (const ix of cols) bs.measure(ix, o, k);
    return speckleContrast(bs, ref, cols, { noisePower: 2 * noise * noise });
  };
  return { src, sc, beam, bs, cols, ref, measure };
}

test('averaging N B-scans of moving tissue: the speckle contrast falls as C₁/√N, the mean brightness stays', () => {
  const { measure } = speckleBench(10 ** (-72 / 20) / Math.SQRT2), out = [];
  const one = measure(1, 'tissue');
  assert(one.C > 1.1 && one.C < 1.45 && one.n > 5000, `one B-scan: contrast ${one.C} over ${one.n} samples`);
  for (const N of [2, 4, 16]) {
    const r = measure(N, 'tissue');
    close(r.C * Math.sqrt(N) / one.C, 1, 0.04, `N = ${N}: C_N √N / C₁`);
    close(r.mean, 1, 0.03, `N = ${N}: the mean of I/I₀`);
    out.push(`${N}: ${r.C.toFixed(3)} (C₁/√N = ${(one.C / Math.sqrt(N)).toFixed(3)}), mean ${r.mean.toFixed(3)}`);
  }
  return `C₁ = ${one.C.toFixed(3)} over ${one.n} samples; ${out.join('; ')}`;
});

test('averaging with nothing moved: the same speckle every time, so the contrast stays (only the noise is new)', () => {
  const { bs, cols, measure } = speckleBench(0), one = measure(1, 'beam', 0), img1 = bs.img.slice();
  const r = measure(8, 'beam', 0);
  let worst = 0;
  for (const ix of cols) for (let m = 0; m < bs.nz; m++) { const a = img1[ix * bs.nz + m]; if (a > 1e-6) worst = Math.max(worst, Math.abs(bs.img[ix * bs.nz + m] / a - 1)); }
  assert(worst < 1e-5, `eight repeats of the same speckle differ from one by ${worst}`);
  close(r.C, one.C, 1e-4, 'contrast');
  // With noise, each repeat's noise is its own, and the contrast still stays.
  const noisy = speckleBench(10 ** (-72 / 20) / Math.SQRT2), n1 = noisy.measure(1, 'beam', 0), n8 = noisy.measure(8, 'beam', 0);
  close(n8.C, n1.C, 0.01 * n1.C, 'with noise');
  return `without noise the average of 8 equals one B-scan to ${worst.toExponential(1)}, contrast ${r.C.toFixed(3)}; with the noise floor at −72 dB: ${n1.C.toFixed(3)} → ${n8.C.toFixed(3)}`;
});

test('the speckle grain is a beam wide: two A-scans δ apart are correlated e^{−2δ²/w²} in intensity', () => {
  const src = new Source(840, 50), sc = makeScene('retina', { lesion: false }), beam = sceneBeam(sc, src, 0.03, 260), bs = new BScan(sc, src);
  const cols = [];
  for (let ix = 3; ix < bs.nx; ix += 8) cols.push(ix);
  const nz = bs.nz, a = new Float64Array(nz), b = new Float64Array(nz), m0 = new Float64Array(nz), ws = regionWidths(bs, beam, cols, 1), out = [];
  for (const f of [0.5, 1, 1.5]) {
    const d = f * beam.w0;
    let su = 0, sv = 0, suu = 0, svv = 0, suv = 0, n = 0;
    for (const ix of cols) {
      const x = bs.x(ix);
      column(sc, src, x, 0, bs.hd, nz, a, { beam, speckle: true });
      column(sc, src, x, d, bs.hd, nz, b, { beam, speckle: true });
      column(sc, src, x, 0, bs.hd, nz, m0, { beam, speckle: false, quick: true });
      for (const [p, q] of speckleRegion(sc, x, 0, bs.hd, nz)) for (let m = p; m < q; m++) {
        const u = (a[m] / m0[m]) ** 2, v = (b[m] / m0[m]) ** 2;
        su += u; sv += v; suu += u * u; svv += v * v; suv += u * v; n++;
      }
    }
    assert(n === ws.length, `${n} samples, ${ws.length} widths`);
    const mu = su / n, mv = sv / n, corr = (suv / n - mu * mv) / Math.sqrt((suu / n - mu * mu) * (svv / n - mv * mv));
    const want = ws.reduce((s, w) => s + Math.exp((-2 * d * d) / (w * w)), 0) / n;
    assert(Math.abs(corr - want) < 0.03, `δ = ${d.toFixed(2)} μm: correlation ${corr}, want ${want}`);
    out.push(`δ = ${f} w₀: ${corr.toFixed(3)} (${want.toFixed(3)})`);
  }
  return `${out.join('; ')}; w₀ = ${beam.w0.toFixed(2)} μm, the beam's width averaged over the samples`;
});

test('averaging beams a step apart: C_N = C₁ √(Σ_jk e^{−2δ_jk²/w²})/N', () => {
  const { beam, bs, cols, measure } = speckleBench(0), one = measure(1, 'beam', 0), ws = regionWidths(bs, beam, cols, 3), out = [];
  close(averagedContrast(repeatPlan(16, 'tissue'), 9), 0.25, 1e-12, 'independent repeats: 1/√16');
  close(averagedContrast(repeatPlan(16, 'beam', 0), 9), 1, 1e-12, 'the same repeat sixteen times');
  for (const [step, N] of [[4.5, 16], [9, 4], [9, 16], [18, 16]]) {
    const r = measure(N, 'beam', step), want = averagedContrast(repeatPlan(N, 'beam', step), ws);
    close(r.C / one.C, want, 0.03 * want, `step ${step} μm, N = ${N}`);
    out.push(`${step} μm × ${N}: ${(r.C / one.C).toFixed(3)} of C₁ (${want.toFixed(3)})`);
  }
  return out.join('; ');
});

// ------------------------------------------------------------------------- flattening

test('a flattened en-face slab follows its layer: one layer under every A-scan, where a flat plane crosses several', () => {
  const src = new Source(840, 50), sc = makeScene('retina', { lesion: false }), beam = sceneBeam(sc, src, 0.03, 260);
  const v = new Volume(sc, src, { nx: 16, ny: 16, nz: 256 }), n = v.nx * v.ny;
  v.measureAll({ beam, speckle: false });
  const bandUnder = (ix, iy, row) => {
    const prof = sc.profile(v.x(ix), v.y(iy)), d = (row + 0.5) * v.hd;
    let lo = 0, hi = sc.depth;
    for (let it = 0; it < 40; it++) { const z = 0.5 * (lo + hi); if (sc.zToD(prof, z) < d) lo = z; else hi = z; }
    return sc.bandAt(prof, 0.5 * (lo + hi));
  };
  const cv = (a) => { let s = 0, s2 = 0; for (const x of a) { s += x; s2 += x * x; } const m = s / a.length; return Math.sqrt(s2 / a.length - m * m) / m; };
  const out = [];
  // (Not the surface: over the pit the inner layers thin to nothing, so no depth below the surface
  // stays in one of them.)  In the pigment epithelium, and in the photoreceptors above it:
  for (const [band, below, inside] of [[7, 11, 7], [7, -18, 6]]) {
    const L = v.layerDepths(band);
    let mean = 0, worst = 0;
    const seen = new Map(), flatSeen = new Map();
    for (let iy = 0; iy < v.ny; iy++) for (let ix = 0; ix < v.nx; ix++) {
      const row = v.followRow(L[iy * v.nx + ix], below);
      mean += row / n;
      // The slab's middle is `below` μm under the layer, to within half a sample.
      worst = Math.max(worst, Math.abs(((Math.round(row) + 0.5) * v.hd - L[iy * v.nx + ix]) / sc.nView - below));
      const b = bandUnder(ix, iy, Math.round(row));
      seen.set(b, (seen.get(b) || 0) + 1);
    }
    for (let iy = 0; iy < v.ny; iy++) for (let ix = 0; ix < v.nx; ix++) { const b = bandUnder(ix, iy, Math.round(mean)); flatSeen.set(b, (flatSeen.get(b) || 0) + 1); }
    assert(worst <= v.hd / (2 * sc.nView) + 1e-9, `the slab ${worst} μm off`);
    assert(seen.size === 1 && seen.get(inside) === n, `following band ${band} at ${below} μm: bands ${[...seen]}`);
    assert(flatSeen.size >= 2 && Math.max(...flatSeen.values()) < 0.9 * n, `flat plane: bands ${[...flatSeen]}`);
    const fol = v.sliceFollow(L, below, 1), flat = v.sliceXY(Math.round(mean));
    // sliceFollow takes the samples it says it does.
    const ix = 5, iy = 9, m = Math.round(v.followRow(L[iy * v.nx + ix], below));
    close(fol[iy * v.nx + ix], v.data[(iy * v.nx + ix) * v.nz + m], 1e-12, 'one sample');
    const thick = v.sliceFollow(L, below, 5)[iy * v.nx + ix];
    let s5 = 0;
    for (let q = m - 2; q <= m + 2; q++) s5 += v.data[(iy * v.nx + ix) * v.nz + q];
    close(thick, s5 / 5, 1e-6, 'five samples');
    assert(cv(fol) < 0.25 && cv(flat) > 0.4, `brightness across the slab: following ${cv(fol)}, flat ${cv(flat)}`);
    out.push(`${sc.bands[band].name} ${below > 0 ? '+' : ''}${below} μm: one layer (${sc.bands[inside].name}), spread ${cv(fol).toFixed(2)}; flat at ${((Math.round(mean) + 0.5) * v.hd / sc.nView).toFixed(0)} μm: ${flatSeen.size} layers, spread ${cv(flat).toFixed(2)}`);
  }
  return out.join('; ');
});
