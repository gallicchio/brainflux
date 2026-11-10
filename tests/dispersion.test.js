import { test, assert, close } from './harness.js';
import {
  chiOscillators, chiTimeOscillators, sqrtEps, reflectance, oscillatorResponse, optics, groupIndex,
  FreqGrid, kkImToRe, kkReToIm, impulseResponse, sampleOnGrid, sumRuleOscillators, sumRuleGrid, simpson,
  drivenCharge, fresnel, surfaceWave, sliverRe, sliverTime,
} from '../dispersion/medium.js';
import { incident, planGrid, Propagator, peakTime, moments, maxBefore, carrierTrace, cyclesPerSample } from '../dispersion/pulse.js';

// Largest |a - b| over the indices whose frequency is within |w| < wmax.
function maxErr(grid, a, b, wmax, skip = () => false) {
  let m = 0;
  for (let k = 0; k < grid.N; k++) if (Math.abs(grid.w[k]) < wmax && !skip(grid.w[k])) m = Math.max(m, Math.abs(a[k] - b[k]));
  return m;
}
const maxAbs = (a) => a.reduce((m, v) => Math.max(m, Math.abs(v)), 0);

// ------------------------------------------------------------------ Kramers–Kronig

test('KK: the Hilbert transform of a Lorentzian pair is the analytic dispersion curve, converging as 1/Ω²', () => {
  // χ = 1/(ω0 − ω − iγ) − 1/(−ω0 − ω − iγ): poles in the lower half plane, so causal.
  const w0 = 2, g = 0.1;
  const errs = [16, 32, 64].map((Omega) => {
    const grid = new FreqGrid(16384 * (Omega / 16), Omega), N = grid.N;
    const im = new Float64Array(N), re = new Float64Array(N);
    for (let k = 0; k < N; k++) {
      const w = grid.w[k], a = w0 - w, b = w0 + w;
      im[k] = g / (a * a + g * g) - g / (b * b + g * g);
      re[k] = a / (a * a + g * g) + b / (b * b + g * g);
    }
    im[N / 2] = 0;
    const reKK = kkImToRe(im), imKK = kkReToIm(re);
    return [maxErr(grid, reKK, re, 4) / maxAbs(re), maxErr(grid, imKK, im, 4) / maxAbs(im)];
  });
  assert(errs[1][0] < 1e-3 && errs[1][1] < 1e-4, `relative errors at Ω = 32: ${errs[1]}`);
  assert(errs[0][0] / errs[1][0] > 3.5 && errs[1][0] / errs[2][0] > 3.5, `Im -> Re errors should fall as 1/Ω²: ${errs.map((e) => e[0].toExponential(2))}`);
  return `relative error Im->Re ${errs.map((e) => e[0].toExponential(1)).join(', ')} and Re->Im ${errs.map((e) => e[1].toExponential(1)).join(', ')} at Ω = 16, 32, 64`;
});

test('KK: a Gaussian absorption line gives Dawson-function dispersion', () => {
  // Re χ(ω) = (1/π) P∫ Im χ(ω')/(ω' − ω) dω' = −(2/√π) [D((ω−ω0)/σ) − D((ω+ω0)/σ)],
  // D(x) = e^{−x²} ∫_0^x e^{t²} dt.
  // The error is the periodic grid's: Re χ ~ 1/ω² far out, and its images every 2Ω add up to
  // about (π²/12) × (that coefficient)/Ω², so it falls fourfold each time Ω doubles.
  const dawson = (x) => simpson((t) => Math.exp((t - x) * (t + x)), 0, x, 2000);
  const w0 = 2, s = 0.3;
  const errs = [32, 64].map((Omega) => {
    const grid = new FreqGrid(16384 * (Omega / 32), Omega), N = grid.N;
    const im = new Float64Array(N);
    for (let k = 0; k < N; k++) { const w = grid.w[k]; im[k] = Math.exp(-(((w - w0) / s) ** 2)) - Math.exp(-(((w + w0) / s) ** 2)); }
    im[N / 2] = 0;
    const re = kkImToRe(im);
    let err = 0;
    for (let k = 0; k < N / 2; k += 37) {
      const w = grid.w[k];
      if (w > 5) break;
      const exact = (-2 / Math.sqrt(Math.PI)) * (dawson((w - w0) / s) - dawson((w + w0) / s));
      err = Math.max(err, Math.abs(re[k] - exact));
    }
    return err;
  });
  assert(errs[0] < 1e-3 && errs[0] / errs[1] > 3.5, `max errors ${errs}`);
  return `max error ${errs[0].toExponential(2)} at Ω = 32, ${errs[1].toExponential(2)} at Ω = 64 (the peak of Re χ is 0.61)`;
});

test('KK: a box of absorption gives logarithmic peaks at its edges, (h/π) ln|(b² − ω²)/(a² − ω²)|', () => {
  const grid = new FreqGrid(16384, 32), N = grid.N, dw = grid.dw, h = 0.5;
  const ka = 300, kb = 700, a = (ka + 0.5) * dw, b = (kb + 0.5) * dw; // edges between samples
  const im = new Float64Array(N);
  for (let k = ka + 1; k <= kb; k++) { im[k] = h; im[N - k] = -h; }
  const re = kkImToRe(im);
  // Sampling a jump costs about h/(π² m) at m samples from it (the transform of the sampled box
  // is that of its band-limited interpolant, which rings).
  const errAt = (m) => {
    let err = 0;
    for (let k = 1; k < 1200; k++) {
      if (Math.abs(k - ka - 0.5) < m || Math.abs(k - kb - 0.5) < m) continue;
      const w = grid.w[k], exact = (h / Math.PI) * Math.log(Math.abs((b * b - w * w) / (a * a - w * w)));
      err = Math.max(err, Math.abs(re[k] - exact));
    }
    return err;
  };
  const e20 = errAt(20), e80 = errAt(80);
  // Far from the edges what is left is the periodic grid's 1/Ω² error, as for the Lorentzian.
  assert(e20 < (2 * h) / (Math.PI ** 2 * 20) && e80 < e20 / 2, `max errors ${e20}, ${e80}`);
  return `max error ${e20.toExponential(2)} beyond 20 samples from an edge, ${e80.toExponential(2)} beyond 80 (h = ${h})`;
});

const OSCS = [
  { w0: 1.2, g: 0.15, wp: 0.8 },   // a bound, underdamped line
  { w0: 2.5, g: 0.6, wp: 1.1 },    // a broad one
  { w0: 0.6, g: 2.0, wp: 0.5 },    // overdamped (γ > 2ω0)
];

test('the Lorentz model satisfies the Kramers–Kronig relations both ways', () => {
  const grid = new FreqGrid(16384, 40), resp = oscillatorResponse(OSCS);
  const { re, im } = sampleOnGrid(resp, grid);
  const reKK = kkImToRe(im), imKK = kkReToIm(re);
  const e1 = maxErr(grid, reKK, re, 5) / maxAbs(re), e2 = maxErr(grid, imKK, im, 5) / maxAbs(im);
  assert(e1 < 1e-3 && e2 < 1e-3, `relative errors ${e1}, ${e2}`);
  // The static limit, the KK relation at ω = 0: ε(0) − 1 = (2/π) ∫_0^∞ Im χ(ω)/ω dω.
  const f = (w) => { const o = chiOscillators(OSCS, Float64Array.of(w)); return o.im[0] / w; };
  let integral = 0, edges = [1e-9, 0.3, 0.8, 1.0, 1.1, 1.2, 1.3, 1.4, 1.6, 2, 2.5, 3, 4, 8, 16, 64, 256, 1024, 8192];
  for (let i = 0; i + 1 < edges.length; i++) integral += simpson(f, edges[i], edges[i + 1], 200);
  const chi0 = OSCS.reduce((s, o) => s + (o.wp * o.wp) / (o.w0 * o.w0), 0);
  close((2 / Math.PI) * integral, chi0, 1e-5 * chi0, 'static KK');
  return `relative errors ${e1.toExponential(2)} (Im -> Re), ${e2.toExponential(2)} (Re -> Im); χ(0) = ${chi0.toFixed(5)} = (2/π)∫ Im χ/ω dω`;
});

test('χ(t) from the FFT is causal and matches the exact impulse response', () => {
  const grid = new FreqGrid(16384, 40), resp = oscillatorResponse(OSCS);
  const { re, im } = sampleOnGrid(resp, grid);
  const ct = impulseResponse(grid, re, im), t = grid.times(), exact = chiTimeOscillators(OSCS, t);
  let errPos = 0, neg = 0, top = 0, imag = 0;
  for (let n = 0; n < grid.N; n++) {
    top = Math.max(top, Math.abs(exact[n]));
    imag = Math.max(imag, Math.abs(ct.im[n]));
    if (t[n] > 0.5 && t[n] < 200) errPos = Math.max(errPos, Math.abs(ct.re[n] - exact[n]));
    if (t[n] < -0.5 && t[n] > -200) neg = Math.max(neg, Math.abs(ct.re[n]));
  }
  assert(errPos < 1e-3 * top && neg < 1e-3 * top && imag < 1e-12 * top, `t > 0 error ${errPos}, |χ(t < 0)| ${neg}, Im ${imag} (peak ${top})`);
  return `peak ${top.toFixed(3)}; error for t > 0.5: ${errPos.toExponential(1)}; largest |χ| for t < −0.5: ${neg.toExponential(1)}`;
});

test('a free-electron (Drude) term: χ(t) → S/γ, causal, with its δ(ω) in Re χ', () => {
  const oscs = [{ w0: 0, g: 0.3, wp: 1 }], grid = new FreqGrid(16384, 40);
  const { re, im } = sampleOnGrid(oscillatorResponse(oscs), grid);
  const ct = impulseResponse(grid, re, im), t = grid.times(), exact = chiTimeOscillators(oscs, t);
  let errPos = 0, neg = 0;
  for (let n = 0; n < grid.N; n++) {
    if (t[n] > 0.5 && t[n] < 30) errPos = Math.max(errPos, Math.abs(ct.re[n] - exact[n]));
    if (t[n] < -0.5 && t[n] > -30) neg = Math.max(neg, Math.abs(ct.re[n]));
  }
  const top = 1 / 0.3;
  // A step that never decays is not periodic: on the grid's period T = 2π/dω it picks up a tilt of order t/T.
  assert(errPos < 0.05 * top && neg < 0.05 * top, `t > 0 error ${errPos}, t < 0 ${neg} (S/γ = ${top})`);
  return `for |t| < 30: error ${(errPos / top * 100).toFixed(2)}% of S/γ for t > 0, ${(neg / top * 100).toFixed(2)}% for t < 0 (period ${(2 * Math.PI / grid.dw).toFixed(0)})`;
});

test('breaking causality: a response with Re χ removed is odd in time, half of it before the kick', () => {
  const grid = new FreqGrid(8192, 20), resp = oscillatorResponse([{ w0: 2, g: 0.2, wp: 1 }]);
  const { im } = sampleOnGrid(resp, grid);
  const ct = impulseResponse(grid, new Float64Array(grid.N), im), N = grid.N;
  let odd = 0, before = 0, after = 0;
  for (let n = 1; n < N / 2; n++) {
    odd = Math.max(odd, Math.abs(ct.re[n] + ct.re[N - n]));
    before += ct.re[N - n] ** 2; after += ct.re[n] ** 2;
  }
  assert(odd < 1e-12 && Math.abs(before / after - 1) < 1e-12, `odd ${odd}, energy before/after ${before / after}`);
});

test('one sliver of absorption: its share of Re χ and its ring in time, against the FFT', () => {
  const grid = new FreqGrid(16384, 32), N = grid.N, dw = grid.dw, h = 0.7;
  const ka = 400, kb = 460, a = (ka + 0.5) * dw, b = (kb + 0.5) * dw; // edges between samples
  const im = new Float64Array(N);
  for (let k = ka + 1; k <= kb; k++) { im[k] = h; im[N - k] = -h; }
  const re = kkImToRe(im), ws = grid.w.subarray(1, 1200), exact = sliverRe(a, b, h, ws);
  let err = 0;
  for (let i = 0; i < ws.length; i++) if (Math.abs(i + 1 - ka - 0.5) > 20 && Math.abs(i + 1 - kb - 0.5) > 20) err = Math.max(err, Math.abs(re[i + 1] - exact[i]));
  // (Each sampled edge rings by about h/(π² m) at m samples from it; a sliver has two close together.)
  assert(err < (4 * h) / (Math.PI ** 2 * 20), `share of Re χ: max error ${err}`);
  // Positive below the sliver, negative above: the 1/(ω' − ω) of the integral.
  const mid = (a + b) / 2, far = sliverRe(a, b, h, Float64Array.of(0.5 * mid, 2 * mid));
  assert(far[0] > 0 && far[1] < 0, `signs ${far}`);
  close(far[1], (2 * mid * h * (b - a)) / (Math.PI * (mid * mid - 4 * mid * mid)), 0.01 * Math.abs(far[1]), 'far tail');
  // In time: with its share (causal) the ring starts at the kick; without, it is odd.
  const t = grid.times(), both = impulseResponse(grid, re, im).re, alone = impulseResponse(grid, new Float64Array(N), im).re;
  const sc = sliverTime(a, b, h, t, true), so = sliverTime(a, b, h, t, false);
  let e1 = 0, e2 = 0, top = 0;
  for (let n = 0; n < N; n++) {
    if (Math.abs(t[n]) > 2 && Math.abs(t[n]) < 60) { e1 = Math.max(e1, Math.abs(both[n] - sc[n])); e2 = Math.max(e2, Math.abs(alone[n] - so[n])); }
    top = Math.max(top, Math.abs(sc[n]));
  }
  assert(e1 < 2e-3 * top && e2 < 2e-3 * top, `χ(t): errors ${e1}, ${e2} (peak ${top})`);
  return `share of Re χ within ${err.toExponential(1)} of (h/π) ln|(b² − ω²)/(a² − ω²)|; χ(t) within ${(Math.max(e1, e2) / top).toExponential(1)} of the peak, causal and not`;
});

// ------------------------------------------------------------------- the sum rule

test('the f-sum rule: ∫ ω Im ε dω = π ω_p²/2, whatever the lines look like', () => {
  // (The last set is fused silica with lines 1e-4 wide, as in the demo.)
  const silica = [[0.6961663, 18.1253], [0.4079426, 10.6661], [0.8974794, 0.125283]].map(([B, w0]) => ({ w0, g: 1e-4, wp: Math.sqrt(B) * w0 }));
  const sets = [OSCS, [{ w0: 0, g: 0.05, wp: 3 }], [{ w0: 4, g: 0.01, wp: 0.5 }, { w0: 0, g: 1, wp: 1 }], [{ w0: 1, g: 5, wp: 2 }], silica];
  const notes = [];
  for (const s of sets) {
    const wp2 = s.reduce((a, o) => a + o.wp * o.wp, 0), I = sumRuleOscillators(s);
    close(I, (Math.PI / 2) * wp2, 2e-6 * wp2, `sum rule for ${JSON.stringify(s)}:`);
    notes.push((I / (Math.PI / 2 * wp2)).toFixed(7));
    // The same total sets the high-frequency limit: χ → −ω_p²/ω².
    const W = 1e5, { re } = chiOscillators(s, Float64Array.of(W));
    close(-re[0] * W * W, wp2, 1e-6 * wp2, 'ω² χ at high frequency');
  }
  // On the Kramers–Kronig grid (a drawn medium is integrated this way).
  const grid = new FreqGrid(16384, 40), { im } = sampleOnGrid(oscillatorResponse(OSCS), grid);
  const wp2 = OSCS.reduce((a, o) => a + o.wp * o.wp, 0), Ig = sumRuleGrid(grid, im);
  close(Ig, (Math.PI / 2) * wp2, 2e-3 * wp2, 'sum rule on the grid');
  return `integral / (π ω_p²/2) = ${notes.join(', ')}; on the grid ${(Ig / (Math.PI / 2 * wp2)).toFixed(5)}`;
});

// ---------------------------------------------------------------- index, reflectance

test('√ε on the physical branch: κ ≥ 0 for a passive medium, n = 0 for a lossless metal', () => {
  for (let i = 0; i < 2000; i++) {
    const er = (Math.random() - 0.5) * 20 * Math.random(), ei = Math.random() * 10 * Math.random() ** 3;
    const [n, k] = sqrtEps(er, ei);
    assert(n >= 0 && k >= 0, `ε = ${er} + ${ei}i gave ${n} + ${k}i`);
    close(n * n - k * k, er, 1e-12 * (1 + Math.abs(er)), 'Re ñ²');
    close(2 * n * k, ei, 1e-12 * (1 + Math.abs(ei)), 'Im ñ²');
  }
  const [n, k] = sqrtEps(-4, 0);
  assert(n === 0 && k === 2, `√(−4) = ${n} + ${k}i`);
  close(reflectance(0, 2), 1, 1e-15, 'R of a lossless metal');
  // Glass: R = ((n − 1)/(n + 1))² = 4% at n = 1.5.
  close(reflectance(1.5, 0), 0.04, 1e-15, 'R of glass');
});

test('a Drude metal reflects everything below ω_p and turns transparent above it', () => {
  const wp = 5.9, resp = oscillatorResponse([{ w0: 0, g: 0, wp }]);
  const w = Float64Array.from({ length: 200 }, (_, i) => 0.05 + (i * 12) / 200);
  const { R, n } = optics(resp, w);
  for (let i = 0; i < w.length; i++) {
    if (w[i] < wp) close(R[i], 1, 1e-12, `R at ω = ${w[i]}`);
    else close(n[i], Math.sqrt(1 - (wp * wp) / (w[i] * w[i])), 1e-12, `n at ω = ${w[i]}`);
  }
  // Far above ω_p, R → (ω_p/2ω)⁴.
  const { R: Rhi } = optics(resp, Float64Array.of(100 * wp));
  close(Rhi[0] / (1 / 200) ** 4, 1, 1e-3, 'R far above ω_p');
});

test('an ionic crystal: Re ε = 0 at ω_LO = ω_TO √(ε(0)/ε∞) (Lyddane–Sachs–Teller), R = 1 between', () => {
  const wTO = 4.9, epsInf = 2.34, eps0 = 5.9, S = (eps0 - epsInf) * wTO * wTO;
  const resp = oscillatorResponse([{ w0: wTO, g: 0, wp: Math.sqrt(S) }], epsInf);
  const wLO = wTO * Math.sqrt(eps0 / epsInf);
  const { er } = optics(resp, Float64Array.of(wLO, 1e-9));
  close(er[0], 0, 1e-12, 'ε(ω_LO)');
  close(er[1], eps0, 1e-9, 'ε(0)');
  const w = Float64Array.from({ length: 50 }, (_, i) => wTO + ((i + 0.5) * (wLO - wTO)) / 50);
  const { R } = optics(resp, w);
  for (let i = 0; i < w.length; i++) close(R[i], 1, 1e-12, `R in the reststrahlen band at ${w[i]}`);
  // With damping, nearly total: above 90% across the middle of the band.
  const damped = oscillatorResponse([{ w0: wTO, g: 0.1, wp: Math.sqrt(S) }], epsInf);
  const mid = Float64Array.from({ length: 20 }, (_, i) => wTO + 0.15 * (wLO - wTO) + (i * 0.7 * (wLO - wTO)) / 19);
  const Rd = optics(damped, mid).R;
  assert(Math.min(...Rd) > 0.85, `R with damping ${Math.min(...Rd)}`);
  return `ω_LO = ${wLO.toFixed(3)}; with γ = 0.1 (2% of ω_TO), R ≥ ${Math.min(...Rd).toFixed(3)} across the middle 70% of the band`;
});

test('a driven charge: in step below the line, a quarter period late on it, opposite above', () => {
  const o = { w0: 2, g: 0.2, wp: 1 };
  const lo = drivenCharge(o, 0.01), at = drivenCharge(o, 2), hi = drivenCharge(o, 40);
  close(lo.amp, 1, 1e-4, 'amplitude far below: the static pull');
  close(lo.lag, 0, 1e-3, 'lag far below');
  close(at.amp, o.w0 / o.g, 1e-12, 'amplitude at the resonance: Q = ω0/γ');
  close(at.lag, Math.PI / 2, 1e-12, 'lag at the resonance');
  close(hi.lag, Math.PI, 1e-2, 'lag far above');
  close(hi.amp, (2 / 40) ** 2, 1e-5, 'amplitude far above: (ω0/ω)²');
  // Its χ is (S/ω0²) A e^{iδ}: the in-phase part is Re χ, the late part Im χ.
  for (const w of [0.5, 1.7, 1.95, 2.1, 3]) {
    const d = drivenCharge(o, w), c = chiOscillators([o], Float64Array.of(w)), s = (o.wp * o.wp) / (o.w0 * o.w0);
    close(s * d.amp * Math.cos(d.lag), c.re[0], 1e-12, `Re χ at ${w}`);
    close(s * d.amp * Math.sin(d.lag), c.im[0], 1e-12, `Im χ at ${w}`);
  }
  // A free charge lags by more than a quarter period at every frequency.
  const free = { w0: 0, g: 0.1, wp: 3 };
  assert([0.05, 0.5, 5].every((w) => drivenCharge(free, w).lag > Math.PI / 2), 'free charge lag');
});

test('a wave meets the medium: E and dE/dz continuous, energy conserved, λ0/n inside', () => {
  for (const [n, k] of [[1.5, 0], [1.29, 0.057], [0.72, 0.84], [0.05, 3], [2.4, 0]]) {
    const { rr, ri, tr, ti } = fresnel(n, k);
    close(1 + rr, tr, 1e-14, 'E continuous (re)'); close(ri, ti, 1e-14, 'E continuous (im)');
    close(1 - rr, n * tr - k * ti, 1e-14, 'dE/dz continuous (re)'); close(-ri, n * ti + k * tr, 1e-14, 'dE/dz continuous (im)');
    close(rr * rr + ri * ri, reflectance(n, k), 1e-14, 'R = |r|²');
    if (k === 0) close(rr * rr + n * (tr * tr + ti * ti), 1, 1e-14, 'R + n|t|² = 1');
    // The field just either side of the surface, at several moments.
    for (const phi of [0, 1, 2.5]) {
      const { E } = surfaceWave(n, k, Float64Array.of(-1e-9, 1e-9), phi);
      close(E[0], E[1], 1e-7, `E at the surface (n = ${n})`);
    }
  }
  // Inside a lossless medium, the crests are λ0/n apart: E(z + 1/n) = E(z).
  const n = 1.5, zs = Float64Array.from({ length: 50 }, (_, i) => 0.1 + i * 0.03);
  const a = surfaceWave(n, 0, zs, 0.7).E, b = surfaceWave(n, 0, Float64Array.from(zs, (z) => z + 1 / n), 0.7).E;
  for (let i = 0; i < zs.length; i++) close(a[i], b[i], 1e-12, 'period λ0/n');
  // With absorption the envelope falls by e in 1/(2πκ) wavelengths.
  const env = surfaceWave(1.2, 0.1, Float64Array.of(1, 1 + 1 / (2 * Math.PI * 0.1)), 0).env;
  close(env[1] / env[0], Math.exp(-1), 1e-12, 'decay length c/κω');
});

// ------------------------------------------------------------------------- pulses

function pulseAt(resp, shape, p, view, z, tc = 0) {
  const g = planGrid(shape, p, view);
  const P = new Propagator(g.N, g.dt, g.t0);
  P.setInput(incident(shape, p, P.t), g.smooth);
  if (resp) P.setMedium(resp); else P.setConstantIndex(1);
  const a = P.field(z, tc);
  return { P, t: Float64Array.from(P.t, (x) => x + tc), re: Float64Array.from(a.re), im: Float64Array.from(a.im) };
}

test('in vacuum a pulse arrives unchanged at z/c; in a constant index n, (n − 1)z/c later', () => {
  const p = { w0: 2, T: 10 }, shape = 'gauss';
  const g = planGrid(shape, p, [-60, 60]);
  const P = new Propagator(g.N, g.dt, g.t0), E0 = incident(shape, p, P.t);
  P.setInput(E0);
  P.setConstantIndex(1);
  let a = P.field(1000);
  let err = 0;
  for (let n = 0; n < g.N; n++) err = Math.max(err, Math.abs(a.re[n] - E0[n]));
  assert(err < 1e-12, `vacuum: ${err}`);
  // n = 1.5: E(z, τ) = E(0, τ − 0.5 z).  With z = 20 the delay is 10.
  P.setConstantIndex(1.5);
  a = P.field(20);
  const shifted = incident(shape, p, Float64Array.from(P.t, (t) => t - 10));
  err = 0;
  for (let n = 0; n < g.N; n++) err = Math.max(err, Math.abs(a.re[n] - shifted[n]));
  assert(err < 1e-9, `constant index: ${err}`);
  // And the analytic signal's modulus is the envelope.
  const env = Math.hypot(a.re[g.N >> 1], a.im[g.N >> 1]), t = P.t[g.N >> 1] - 10;
  close(env, Math.exp((-2 * Math.LN2 * t * t) / 100), 1e-9, 'envelope');
});

test('the group delay is z (dk/dω − 1/c) for a narrow-band pulse in a transparent region', () => {
  // Below a weakly damped line (e^{−κωz} = 0.93 here): T = 200 makes the spectrum narrow enough
  // (r.m.s. 0.006) that the curvature of n_g changes the delay by only ~1e-4.
  const oscs = [{ w0: 2, g: 0.005, wp: 1 }], resp = oscillatorResponse(oscs);
  const p = { w0: 1, T: 200 }, z = 300;
  const ng = groupIndex(resp, Float64Array.of(p.w0), 1e-5)[0], predicted = z * (ng - 1);
  const { P, t, re, im } = pulseAt(resp, 'gauss', p, [-800, predicted + 800], z);
  const m = moments(t, re, im), pk = peakTime(t, re, im);
  close(m.mean, predicted, 1e-3 * predicted, 'centroid delay');
  close(pk.t, predicted, 1e-3 * predicted, 'peak delay');
  // Exactly, for any spectrum: the energy arrives at the spectrum-weighted mean of the group delay,
  // with each frequency weighted by the energy it still carries at z.
  const ngs = groupIndex(resp, P.w.subarray(1), 1e-5);
  let num = 0, den = 0;
  for (let k = 1; k < P.half; k++) {
    const e = (P.Xr[k] ** 2 + P.Xi[k] ** 2) * Math.exp(-2 * P.pi[k] * z);
    if (e < 1e-30) continue;
    num += e * z * (ngs[k - 1] - 1); den += e;
  }
  close(m.mean, num / den, 1e-6 * predicted, 'centroid against the weighted group delay');
  return `n_g = ${ng.toFixed(5)}; z(n_g − 1) = ${predicted.toFixed(3)}, centroid ${m.mean.toFixed(3)} (weighted group delay ${(num / den).toFixed(3)}), peak ${pk.t.toFixed(3)}`;
});

test('normal dispersion spreads a pulse as T(z) = T0 √(1 + (z β2/T0²)²) (fused silica, 800 nm)', () => {
  // Malitson's Sellmeier fit as three undamped oscillators, ω in eV (so t in ħ/eV, z in ħc/eV).
  const silica = [[0.6961663, 18.1253], [0.4079426, 10.6661], [0.8974794, 0.125283]].map(([B, w0]) => ({ w0, g: 0, wp: Math.sqrt(B) * w0 }));
  const resp = oscillatorResponse(silica);
  const w0 = 1.55, h = 1e-3;
  const ng = groupIndex(resp, Float64Array.of(w0 - h, w0 + h), 1e-4), beta2 = (ng[1] - ng[0]) / (2 * h); // d²k/dω²
  close(optics(resp, Float64Array.of(w0)).n[0], 1.4533, 2e-4, 'n of fused silica at 800 nm');
  // 36 fs²/mm in these units: fs² = (1/0.6582)² (ħ/eV)², mm = 1/1.9733e-4 (ħc/eV).
  close(beta2 / (1 / 0.65821 ** 2) * (1 / 1.97327e-4), 36.1, 1.0, 'β2 in fs²/mm');
  const T = 30 / 0.65821, T0 = T / (2 * Math.sqrt(Math.LN2)), LD = (T0 * T0) / beta2, z = 3 * LD;
  const tg = z * (ng[0] + ng[1]) / 2 - z;
  const { t, re, im } = pulseAt(resp, 'gauss', { w0, T }, [-400, 400], z, tg);
  const m = moments(t, re, im);
  // |a|² = e^{−t²/T0²}·...: its r.m.s. width is T0/√2.
  close(m.rms, (T0 / Math.SQRT2) * Math.sqrt(1 + 9), 0.005 * m.rms, 'r.m.s. width at 3 L_D');
  return `β2 = ${(beta2 / (1 / 0.65821 ** 2) / 1.97327e-4).toFixed(2)} fs²/mm; L_D = ${(LD * 1.97327e-4).toFixed(2)} mm; width grew ${(m.rms / (T0 / Math.SQRT2)).toFixed(4)}× (√10 = 3.1623)`;
});

test('nothing arrives before z/c: a sharp front in the anomalous region, and a switched-on carrier', () => {
  // A Gaussian cut off at tf, centred on an absorption line where v_g < 0.
  const resp = oscillatorResponse([{ w0: 2, g: 0.2, wp: Math.sqrt(0.08) }]);
  const p = { w0: 2, T: 40, tf: -24 };
  const out = pulseAt(resp, 'front', p, [-150, 150], 15), vac = pulseAt(null, 'front', p, [-150, 150], 15);
  const peak = maxAbs(out.re), before = maxBefore(out.t, out.re, p.tf - 0.5), vacBefore = maxBefore(vac.t, vac.re, p.tf - 0.5);
  assert(before < 1e-6 * peak, `field before the front: ${before} (peak ${peak})`);
  assert(before < 3 * vacBefore + 1e-12, `the medium adds to the incident field's own leakage: ${before} vs ${vacBefore}`);
  // Sommerfeld and Brillouin's problem: cos(ω t) switched on at t = 0 into a dense Lorentz medium.
  const B = oscillatorResponse([{ w0: 4, g: 0.56, wp: Math.sqrt(20) }]);
  const q = { w0: 2.5, tOff: 60, tRamp: 2 };
  const s = pulseAt(B, 'step', q, [-2, 30], 10);
  const sPeak = maxAbs(s.re), sBefore = maxBefore(s.t, s.re, -0.5);
  assert(sBefore < 1e-6 * sPeak, `switched-on carrier: ${sBefore} before t = z/c (peak ${sPeak})`);
  return `largest field before the front: ${(before / peak).toExponential(1)} of the peak (Gaussian cut at tf), ${(sBefore / sPeak).toExponential(1)} (switched-on carrier)`;
});

test('in the anomalous region the peak exits early (v_g < 0), attenuated, with less energy than went in', () => {
  const resp = oscillatorResponse([{ w0: 2, g: 0.2, wp: Math.sqrt(0.08) }]);
  const p = { w0: 2, T: 40 }, z = 5;
  const ng = groupIndex(resp, Float64Array.of(2), 1e-5)[0];
  const { P, t, re, im } = pulseAt(resp, 'gauss', p, [-150, 150], z);
  const pk = peakTime(t, re, im), m = moments(t, re, im);
  const vac = P.field(0, 0, true), m0 = moments(t, vac.re, vac.im);
  assert(ng < 0 && pk.t < -3, `n_g = ${ng}, peak at ${pk.t}`);
  // Energy: Parseval, Σ |E(z)|² / Σ |E(0)|² = Σ |X|² e^{−2κωz} / Σ |X|².
  let a = 0, b = 0;
  for (let k = 1; k < P.half; k++) { const x = P.Xr[k] ** 2 + P.Xi[k] ** 2; a += x * Math.exp(-2 * P.pi[k] * z); b += x; }
  close(m.energy / m0.energy, a / b, 1e-9, 'transmitted energy');
  assert(m.energy < m0.energy, 'a passive medium only absorbs');
  return `n_g = ${ng.toFixed(3)}: the peak leaves ${(-pk.t).toFixed(2)} before a vacuum pulse would arrive, at ${(pk.peak * 100).toFixed(1)}% of its height, with ${(m.energy / m0.energy * 100).toFixed(1)}% of the energy`;
});

test('a picture in space (the field at one moment at every depth) agrees with the field at one depth', () => {
  // Below a line, where crests outrun the envelope; and a cut front through a weak absorption line.
  const cases = [
    [oscillatorResponse([{ w0: 2, g: 0.1, wp: 1 }]), 'gauss', { w0: 1, T: 20 }, [-60, 80]],
    [oscillatorResponse([{ w0: 2, g: 0.2, wp: Math.sqrt(0.08) }]), 'front', { w0: 2, T: 40, tf: -24 }, [-150, 150]],
  ];
  const notes = [];
  for (const [resp, shape, p, view] of cases) {
    const g = planGrid(shape, p, view), P = new Propagator(g.N, g.dt, g.t0);
    P.setInput(incident(shape, p, P.t), g.smooth);
    P.setMedium(resp);
    const t = 37.3, z0 = 2.5, dz = 0.731, M = 40, snap = P.snapshot(t, z0, dz, M);
    let err = 0, top = 0;
    for (let j = 0; j < M; j += 3) {
      // field(z, tc) gives τ = t_n + tc: choose tc so that sample 0 is τ = t − z.
      const z = z0 + j * dz, a = P.field(z, t - z - P.t0);
      err = Math.max(err, Math.hypot(a.re[0] - snap.re[j], a.im[0] - snap.im[j]));
      top = Math.max(top, Math.hypot(a.re[0], a.im[0]));
    }
    // (The picture leaves out frequencies below 1e-6 of the incident spectrum's peak amplitude.)
    assert(err < 1e-5, `${shape}: snapshot against field(): ${err} (largest ${top})`);
    // Without the local frequency (what the page asks for a front), the same field, to round-off.
    const bare = P.snapshot(t, z0, dz, M, 0, false);
    for (let j = 0; j < M; j++) assert(Math.abs(bare.re[j] - snap.re[j]) <= 1e-12 * top && Math.abs(bare.im[j] - snap.im[j]) <= 1e-12 * top && Number.isNaN(bare.w[j]), `${shape}: the field without the local frequency differs at ${j}`);
    notes.push(`${shape} ${err.toExponential(1)}`);
  }
  // Below the line the crests move at c/n and the envelope at c/n_g: the local frequency at the
  // peak is the carrier, and the incident pulse in vacuum is the same function of t − z.
  // (A long pulse, T = 80, so that its spectrum sees one n_g, and a line with almost no damping:
  // absorption over the length of the pulse would tilt it, e^{−κωz}, and move its peak back.)
  const resp = oscillatorResponse([{ w0: 2, g: 1e-4, wp: 1 }]), p = { w0: 1, T: 80 }, g = planGrid('gauss', p, [-300, 300]), P = new Propagator(g.N, g.dt, g.t0);
  P.setInput(incident('gauss', p, P.t), g.smooth); P.setMedium(resp);
  const ng = groupIndex(resp, Float64Array.of(1), 1e-5)[0], z = 40, s = P.snapshot(z * ng, 0, 0.05, 1600);
  let jmax = 0;
  for (let j = 0; j < 1600; j++) if (s.re[j] ** 2 + s.im[j] ** 2 > s.re[jmax] ** 2 + s.im[jmax] ** 2) jmax = j;
  close(jmax * 0.05, z, 0.1, 'envelope peak at z = t/n_g');
  close(s.w[jmax], 1, 0.01, 'local frequency at the peak');
  const [vr] = P.incidentAt(10 - (-3)), E0 = incident('gauss', p, Float64Array.of(13))[0];
  close(vr, E0, 1e-4, 'incident pulse in vacuum (3 samples a period here)');
  return `snapshot vs field(): ${notes.join(', ')}; the envelope peak at t = ${(z * ng).toFixed(2)} is at z = ${(jmax * 0.05).toFixed(2)} (t/n_g = ${z})`;
});

// ------------------------------------------------------------------ drawing

test('drawing a carrier under its envelope: every crest from three samples a cycle, or a band of many cycles to a pixel', () => {
  // a(t) = e^{−t²/T²} e^{−iωt}, sampled 3 times a cycle.
  const w = 1, T = 30, dt = (2 * Math.PI) / (3 * w), N = 301, re = new Float64Array(N), im = new Float64Array(N);
  const at = (t) => [Math.exp(-(t * t) / (T * T)) * Math.cos(w * t), -Math.exp(-(t * t) / (T * T)) * Math.sin(w * t)];
  for (let n = 0; n < N; n++) [re[n], im[n]] = at((n - 150) * dt);
  const cyc = cyclesPerSample(re, im, 0, N - 1);
  close(cyc, 1 / 3, 1e-9, 'cycles between samples');
  // 100 cycles on 1000 pixels: resolved, 24 points or more to a cycle, right between the samples.
  const r = carrierTrace(re, im, 0, N - 1, 1000, cyc);
  assert(!r.synthetic && r.perPx >= 2.4 && r.y.length === Math.round(r.perPx * 1000) + 1, `${r.perPx} points to a pixel`);
  let err = 0, top = 0;
  for (let k = 0; k < r.y.length; k++) {
    const u = (k * (N - 1)) / (r.y.length - 1);
    err = Math.max(err, Math.abs(r.y[k] - at((u - 150) * dt)[0])); top = Math.max(top, r.y[k]);
  }
  assert(err < 0.01 && top > 0.995, `largest error ${err.toFixed(4)} (straight lines through the samples: ${(1 - Math.cos(Math.PI / 3)).toFixed(2)}); the peak ${top.toFixed(4)}`);
  // 100 cycles on 30 pixels: a band, its edges ±|a| in every pixel.
  const b = carrierTrace(re, im, 0, N - 1, 30, cyc);
  assert(b.synthetic && b.y.length === 30 * 32 + 1, `synthetic ${b.synthetic}, ${b.y.length} points`);
  let edge = 0, out = 0;
  for (let c = 0; c < 30; c++) {
    // (The envelope changes across a pixel here: each pixel's band reaches the least of it there.)
    let lo = Infinity, hi = -Infinity, eMin = Infinity;
    for (let k = 32 * c; k <= 32 * c + 32; k++) {
      const u = (k * (N - 1)) / (b.y.length - 1), env = Math.exp(-(((u - 150) * dt) ** 2) / (T * T));
      lo = Math.min(lo, b.y[k]); hi = Math.max(hi, b.y[k]); out = Math.max(out, Math.abs(b.y[k]) - env); eMin = Math.min(eMin, env);
    }
    edge = Math.max(edge, eMin * Math.cos(Math.PI / 16) - hi, eMin * Math.cos(Math.PI / 16) + lo);
  }
  assert(edge < 0.01 && out < 0.01, `every pixel's band reaches ±|a| (short by at most ${edge.toFixed(4)}); at most ${out.toFixed(4)} outside`);
  return `3 samples a cycle: within ${err.toFixed(4)} between them; 3 cycles a pixel: a band out to ±|a|, short by at most ${edge.toFixed(4)}`;
});
