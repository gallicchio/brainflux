import { test, assert, close } from './harness.js';
import { cmf, xyzToLinear, gamutFix, chromaticity } from '../interferometer/colour.js';
import { Spectrum, SOURCES, LINE_DATA, lineSpectrum, gaussianLine, gridSpectrum, planckSigma, band, GRID } from '../interferometer/spectrum.js';
import { ColourModel, FringeCounter, minMaxOver } from '../interferometer/fringes.js';
import { sampleInterferogram, recoverSpectrum } from '../interferometer/fts.js';
import { MAS, airyAmp, diskVisibility, visibility, visibilityNumeric, makeModel, firstNull, bandSamples, bandVisibility } from '../interferometer/stars.js';
import { besselJ } from '../lib/bessel.js';

// ------------------------------------------------------------------------- colour

test('CIE fit: close to the tabulated 1931 colour matching functions', () => {
  // [nm, x̄, ȳ, z̄] from the CIE 1931 2° tables.
  const table = [[450, 0.3362, 0.038, 1.7721], [500, 0.0049, 0.323, 0.272], [550, 0.4334, 0.995, 0.0087],
    [600, 1.0622, 0.631, 0.0008], [650, 0.2835, 0.107, 0], [555, 0.5121, 1.0, 0.0057]];
  let worst = 0;
  for (const [nm, ...want] of table) {
    const got = cmf(nm);
    for (let c = 0; c < 3; c++) worst = Math.max(worst, Math.abs(got[c] - want[c]));
  }
  assert(worst < 0.04, `worst difference ${worst}`);
  // The three functions have (nearly) equal areas, which makes equal-energy light white.
  const area = [0, 0, 0];
  for (let nm = 360; nm <= 830; nm += 0.5) cmf(nm).forEach((v, c) => { area[c] += v * 0.5; });
  close(area[0] / area[1], 1, 0.01, 'X/Y of equal energy'); close(area[2] / area[1], 1, 0.01, 'Z/Y of equal energy');
  return `largest difference ${worst.toFixed(3)}; areas ${area.map((a) => a.toFixed(2)).join(', ')} (tables: 106.86 each)`;
});

test('CIE fit: white light comes out white, monochromatic light in its own colour', () => {
  // A 6500 K blackbody is close to the sRGB white point (D65): r, g, b nearly equal.
  const XYZ = [0, 0, 0];
  for (let nm = 360; nm <= 830; nm += 1) { const s = 1000 / nm, S = planckSigma(s, 6504) * s * s; cmf(nm).forEach((v, c) => { XYZ[c] += S * v; }); }
  const rgb = xyzToLinear(...XYZ), m = Math.max(...rgb);
  for (const c of rgb) assert(c / m > 0.93, `6500 K: rgb ${rgb.map((v) => (v / m).toFixed(3))}`);
  const [x, y] = chromaticity(...XYZ);
  close(x, 0.3135, 0.004, 'x'); close(y, 0.3237, 0.004, 'y');
  // Sodium is yellow (red and green, little blue), HeNe red, 450 nm blue.
  const na = gamutFix(xyzToLinear(...cmf(589))), he = gamutFix(xyzToLinear(...cmf(632.8))), bl = gamutFix(xyzToLinear(...cmf(450)));
  assert(na[0] > 2 * na[2] && na[1] > 2 * na[2], `sodium ${na}`);
  assert(he[0] > 3 * he[1] && he[0] > 3 * he[2], `HeNe ${he}`);
  assert(bl[2] > 2 * bl[0] && bl[2] > 2 * bl[1], `blue ${bl}`);
  return `6500 K blackbody: (x, y) = (${x.toFixed(4)}, ${y.toFixed(4)}), rgb ${rgb.map((v) => (v / m).toFixed(3)).join(' ')}`;
});

// ------------------------------------------------------------------------- interferograms

test('a monochromatic line: I = I0 (1 + cos 2πσΔ), one fringe per wavelength of path', () => {
  const he = lineSpectrum(LINE_DATA.hene), lam = 0.632816, s = 1 / lam;
  // The laser's line is 0.002 nm wide: its fringes fade as e^{-2π²w²Δ²} (to 1/2 at 9 cm).
  const w = he.lines[0].w;
  let worst = 0;
  for (let i = 0; i < 2000; i++) {
    const D = i * 0.0731;
    worst = Math.max(worst, Math.abs(he.intensity(D) - (1 + Math.exp(-2 * (Math.PI * w * D) ** 2) * Math.cos(2 * Math.PI * s * D))));
  }
  assert(worst < 1e-12, `largest difference ${worst}`);
  close(he.visibility(146), 1, 2e-6, 'visibility at 146 μm');
  // Maxima at multiples of λ, minima half way.
  close(he.intensity(100 * lam), 2, 1e-6, 'maximum'); close(he.intensity(100.5 * lam), 0, 1e-6, 'minimum');
  // A drawn spike of continuum (a triangle of half-width ds) is nearly monochromatic too.
  const tri = gridSpectrum((x) => (Math.abs(x - 1.6) < 1e-9 ? 1 : 0)).normalize();
  close(tri.intensity(10 / 1.6), 1 + Math.sin(Math.PI * GRID.ds * 6.25) ** 2 / (Math.PI * GRID.ds * 6.25) ** 2, 1e-12, 'triangle');
  return `|I - I0(1 + cos 2πσΔ)| < ${worst.toExponential(1)} over 0 < Δ < 146 μm`;
});

test('the continuum: the closed form of Γ(Δ) against brute-force quadrature', () => {
  const sp = SOURCES.lamp.make({ T: 3000 });
  let worst = 0;
  for (const D of [0, 0.31, 1.07, 2.5, 7.3, 40.1]) {
    // ∫ S(σ) cos 2πσΔ dσ by the midpoint rule with 200 points per grid step.
    let q = 0;
    const h = GRID.ds / 200;
    for (let x = GRID.s0 - GRID.ds + h / 2; x < GRID.s0 + GRID.n * GRID.ds; x += h) q += sp.density(x) * Math.cos(2 * Math.PI * x * D) * h;
    worst = Math.max(worst, Math.abs(sp.gamma(D)[0] - q));
  }
  assert(worst < 1e-8, `largest difference ${worst}`);
  close(sp.I0, 1, 1e-12, 'normalised');
  return `largest difference ${worst.toExponential(1)} (I0 = 1)`;
});

test('the sodium doublet: visibility beats with period 1/Δσ = λ²/Δλ ≈ 0.58 mm', () => {
  const na = lineSpectrum(LINE_DATA.sodium);
  const ds = 1000 / 588.995 - 1000 / 589.592, period = 1 / ds;
  // Find the minima of the visibility in 0 ... 1500 μm.
  const minima = [];
  let a = na.visibility(0), b = na.visibility(0.5);
  for (let D = 1; D < 1500; D += 0.5) {
    const c = na.visibility(D);
    if (b < a && b < c) minima.push(D - 0.5);
    a = b; b = c;
  }
  assert(minima.length === 3, `minima at ${minima}`);
  close(minima[0], period / 2, 0.6, 'first minimum'); close(minima[1] - minima[0], period, 0.6, 'period');
  close(minima[2] - minima[1], period, 0.6, 'period');
  // Lines of strength 2 : 1 leave a visibility of (2 - 1)/(2 + 1) at the minima.
  close(na.visibility(period / 2), 1 / 3, 1e-3, 'V_min');
  close(period, 589.29 ** 2 / 0.597 / 1000, 0.5, 'λ²/Δλ');
  return `minima at ${minima.map((m) => m.toFixed(1)).join(', ')} μm; 1/Δσ = ${period.toFixed(1)} μm; V_min = ${na.visibility(period / 2).toFixed(4)}`;
});

test('coherence length: a Gaussian line of width Δλ loses half its visibility at Δ = (2 ln 2 / π) λ²/Δλ', () => {
  for (const [lam, fwhm] of [[550, 10], [633, 1], [450, 40]]) {
    const sp = new Spectrum([gaussianLine(lam, fwhm)]);
    const dSigma = (1000 * fwhm) / (lam * lam), half = (2 * Math.LN2) / (Math.PI * dSigma);
    close(sp.visibility(half), 0.5, 1e-9, `${lam}/${fwhm}`);
    close(sp.visibility(2 * half), 1 / 16, 1e-9, `${lam}/${fwhm} at twice`);   // Gaussian: 0.5^4
  }
  const lc = (2 * Math.LN2) / Math.PI * (550 * 550 / 10) / 1000;
  return `550 nm, 10 nm wide: V = 1/2 at Δ = ${lc.toFixed(2)} μm (λ²/Δλ = 30.25 μm)`;
});

test('white light: fringes only within a few micrometres of zero path', () => {
  const w = SOURCES.white.make();
  assert(w.visibility(0) > 0.999, 'V(0)');
  let last = 0;
  for (let D = 0; D < 20; D += 0.01) if (w.visibility(D) > 0.1) last = D;
  assert(last > 0.4 && last < 3, `V > 0.1 out to ${last}`);
  return `visibility above 0.1 only for |Δ| < ${last.toFixed(2)} μm`;
});

test('the fringe counter counts one fringe per λ/2 of mirror travel', () => {
  const he = lineSpectrum(LINE_DATA.hene), c = new FringeCounter();
  c.reset(0);
  let D = 500;   // mirror at 250 μm, moving by small steps to 260 μm
  for (let i = 0; i < 1000; i++) { const D1 = D + 0.02; c.advance(he, D, D1, 1.6); D = D1; }
  const expected = 20 / 0.632816, forward = c.count;
  assert(Math.abs(forward - expected) <= 1, `${forward} fringes, expected ${expected}`);
  for (let i = 0; i < 1000; i++) { const D1 = D - 0.02; c.advance(he, D, D1, 1.6); D = D1; }
  assert(Math.abs(c.count) <= 1, `back again: ${c.count}`);
  return `10 μm of mirror travel: ${forward} fringes (Δ/λ = ${expected.toFixed(2)}); back again: ${c.count}`;
});

test('the detector trace: min and max over an interval', () => {
  const he = lineSpectrum(LINE_DATA.hene);
  const [lo, hi] = minMaxOver(he, 100, 130, 1.6);
  close(lo, 0, 1e-3, 'min'); close(hi, 2, 1e-3, 'max');
  const [a, b] = minMaxOver(he, 100, 100.01, 1.6);
  assert(Math.abs(a - he.intensity(100)) < 0.05 && b - a < 0.2, `short interval ${a}, ${b}`);
});

// ------------------------------------------------------------------------- the screen's colours

test('screen colours: cell averages of X, Y, Z are exact averages', () => {
  for (const sp of [lineSpectrum(LINE_DATA.mercury), SOURCES.white.make(), SOURCES.led.make()]) {
    const m = new ColourModel(sp), D0 = 1.3, h = 0.07, n = 5;
    const C = m.table(D0, h, n);
    for (let j = 0; j < n; j++) {
      // Brute force: the average of X(Δ) over the cell by 400 point values.
      const avg = [0, 0, 0];
      for (let q = 0; q < 400; q++) { const v = m.xyzAt(D0 + (j + (q + 0.5) / 400) * h); for (let c = 0; c < 3; c++) avg[c] += v[c] / 400; }
      for (let c = 0; c < 3; c++) close((C[3 * j + 3 + c] - C[3 * j + c]) / h, avg[c], 2e-5 * m.base[1] + 1e-9, `cell ${j} channel ${c}`);
    }
  }
});

test('screen colours: white fringes at zero path, a uniform white far from it; sodium is yellow', () => {
  // Equal-energy light has chromaticity (1/3, 1/3) (a little warmer than the screen's D65 white).
  const w = new ColourModel(SOURCES.white.make());
  const [x, y] = chromaticity(...w.xyzAt(50));
  close(x, 1 / 3, 0.006, 'x far from zero path'); close(y, 1 / 3, 0.006, 'y far from zero path');
  const zero = w.xyzAt(0);
  for (let c = 0; c < 3; c++) close(zero[c], 2 * w.base[c], 1e-9, 'zero path: twice the mean');
  const na = new ColourModel(lineSpectrum(LINE_DATA.sodium)), rgb = gamutFix(xyzToLinear(...na.base));
  assert(rgb[0] > 2 * rgb[2] && rgb[1] > 2 * rgb[2], `sodium ${rgb}`);
});

// ------------------------------------------------------------------------- Fourier-transform spectroscopy

test('FT spectroscopy: sampling by FFT agrees with direct sums', () => {
  const sp = SOURCES.lamp.make({ T: 2500 });
  sp.lines.push(gaussianLine(500, 3, 0.2)); sp.update();
  for (const [step, K] of [[0.1, 1000], [0.37, 3000], [0.05, 4000]]) {
    const a = sampleInterferogram(sp, step, K, 'fft'), b = sampleInterferogram(sp, step, K, 'direct');
    let worst = 0;
    for (let k = 0; k <= K; k++) worst = Math.max(worst, Math.abs(a[k] - b[k]));
    assert(worst < 2e-4, `step ${step}: ${worst}`);
  }
});

test('FT spectroscopy round trip: a smooth spectrum comes back', () => {
  const sp = SOURCES.lamp.make({ T: 4000 });
  sp.lines.push(gaussianLine(520, 30, 0.5)); sp.update();
  const step = 0.1, K = 3000;    // Δmax = 300 μm, Nyquist σ = 5 μm⁻¹
  const I = sampleInterferogram(sp, step, K), r = recoverSpectrum(I, step, { pad: 2 });
  let worst = 0, peak = 0, area = 0;
  for (let m = 0; m < r.v.length; m++) {
    const s = m * r.ds;
    peak = Math.max(peak, sp.density(s));
    worst = Math.max(worst, Math.abs(r.v[m] - sp.density(s)));
    area += r.v[m] * r.ds;
  }
  assert(worst < 0.01 * peak, `largest difference ${worst} (peak ${peak})`);
  close(area, sp.I0, 0.002 * sp.I0, 'area');
  return `largest difference ${(100 * worst / peak).toFixed(3)}% of the peak; area ${area.toFixed(5)} (I0 = ${sp.I0.toFixed(5)})`;
});

function peaks(r, lo, hi) {
  const out = [];
  for (let m = 1; m + 1 < r.v.length; m++) {
    const s = m * r.ds;
    if (s < lo || s > hi) continue;
    if (r.v[m] > r.v[m - 1] && r.v[m] >= r.v[m + 1]) out.push([s, r.v[m]]);
  }
  const top = Math.max(...out.map((p) => p[1]));
  return out.filter((p) => p[1] > 0.3 * top);
}

test('FT spectroscopy: the scan length sets the resolution (the sodium doublet)', () => {
  const na = lineSpectrum(LINE_DATA.sodium), s2 = 1000 / 588.995, s1 = 1000 / 589.592;
  const step = 0.25;
  // 2 mm of path: two lines where they should be.
  let r = recoverSpectrum(sampleInterferogram(na, step, 8000), step, { pad: 4 });
  let p = peaks(r, 1.69, 1.705);
  assert(p.length === 2, `2 mm: ${p.length} peaks`);
  close(p[0][0], s1, r.ds, 'D1'); close(p[1][0], s2, r.ds, 'D2');
  // 0.2 mm: Δσ = 0.0017 is below the resolution 1/(2 Δmax) = 0.0025: one peak.
  r = recoverSpectrum(sampleInterferogram(na, step, 800), step, { pad: 16 });
  p = peaks(r, 1.69, 1.705);
  assert(p.length === 1, `0.2 mm: ${p.length} peaks`);
  return 'resolved with Δmax = 2 mm, one peak with Δmax = 0.2 mm';
});

test('FT spectroscopy: too coarse a step folds a line back below σ_N = 1/(2δ)', () => {
  const he = lineSpectrum(LINE_DATA.hene), s = 1000 / 632.816;
  for (const step of [0.2, 0.4, 0.55]) {
    const r = recoverSpectrum(sampleInterferogram(he, step, 500), step, { pad: 8 });
    let best = 0;
    for (let m = 0; m < r.v.length; m++) if (r.v[m] > r.v[best]) best = m;
    const sN = 1 / (2 * step);
    let want = s % (1 / step);
    if (want > sN) want = 1 / step - want;
    close(best * r.ds, want, r.ds, `step ${step}`);
  }
  return 'HeNe at σ = 1.580 μm⁻¹ shows at 0.920 with δ = 0.4 μm, 0.238 with δ = 0.55 μm';
});

// ------------------------------------------------------------------------- stellar interferometer

test('a uniform disk: the Fourier transform of its brightness is 2J₁(x)/x, x = πBθ/λ', () => {
  const theta = 47 * MAS, lam = 575e-9, model = makeModel({ theta });
  let worst = 0;
  for (const B of [0.5, 1.5, 2.5, 3.08, 4, 5.5]) {
    const u = B / lam, x = Math.PI * theta * u;
    const exact = (2 * besselJ(1, x)[1]) / x;
    const [re, im] = visibilityNumeric(model, u, 500);
    worst = Math.max(worst, Math.abs(re - exact), Math.abs(im));
    close(visibility(model, u)[0], exact, 1e-12, 'closed form');
  }
  assert(worst < 2e-4, `numerical transform differs by ${worst}`);
  // First zero at 1.22 λ/θ: for Betelgeuse in 1920, θ = 0.047" at 575 nm, about 3.08 m.
  const B0 = firstNull(model, lam, 10);
  close(B0, (3.8317 / Math.PI) * lam / theta, 1e-4, 'first null');
  return `numerical transform within ${worst.toExponential(1)}; first null at ${B0.toFixed(3)} m = ${(B0 * theta / lam).toFixed(4)} λ/θ`;
});

test('a limb-darkened disk: the first null moves out to 1.43 λ/θ', () => {
  const theta = 20 * MAS, lam = 500e-9, model = makeModel({ theta, limb: 1 });
  for (const B of [1, 3, 6]) {
    const u = B / lam, [re] = visibilityNumeric(model, u, 500);
    close(visibility(model, u)[0], re, 3e-4, `B = ${B}`);
  }
  const B0 = firstNull(model, lam, 20);
  close(B0 * theta / lam, 4.4934 / Math.PI, 1e-4, 'first null');
  return `first null at ${(B0 * theta / lam).toFixed(4)} λ/θ`;
});

test('a binary star: visibility beats with minima |1 - r|/(1 + r)', () => {
  const lam = 550e-9, rho = 50 * MAS, r = 0.8;
  for (const pa of [0, Math.PI / 4]) {
    const model = makeModel({ theta: 0, binary: true, rho, pa, ratio: r });
    const Bmin = lam / (2 * rho * Math.cos(pa));          // half a fringe between the two stars
    const v = (B) => Math.hypot(...visibility(model, B / lam));
    close(v(Bmin), (1 - r) / (1 + r), 1e-12, 'minimum');
    close(v(2 * Bmin), 1, 1e-12, 'maximum');
    close(v(3 * Bmin), (1 - r) / (1 + r), 1e-12, 'second minimum');
  }
  // Over a band of wavelengths the beats wash out: the m-th maximum has the stars' fringes
  // m whole fringes apart at λ0, and a different number at other wavelengths (towards 1/2,
  // two equal stars adding their light without interference).
  const model = makeModel({ theta: 0, binary: true, rho, pa: 0, ratio: 1 }), band = bandSamples(lam, 50e-9);
  const at = (m) => Math.hypot(...bandVisibility(model, (m * lam) / rho, band));
  assert(at(1) > 0.95 && at(2) > at(4) && at(4) > at(8) && at(8) < 0.7, `maxima ${[1, 2, 4, 8].map(at)}`);
  // A narrow band is the monochromatic visibility.
  const disk = makeModel({ theta: 47 * MAS }), B = 2;
  close(bandVisibility(disk, B, bandSamples(575e-9, 1e-12))[0], visibility(disk, B / 575e-9)[0], 1e-9, 'narrow band');
  return `50 nm band: beat maxima 1, 2, 4, 8 at ${[1, 2, 4, 8].map((m) => at(m).toFixed(3)).join(', ')}`;
});
