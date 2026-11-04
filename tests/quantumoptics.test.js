import { test, assert, close } from './harness.js';
import {
  covariance, gaussianState, rotated, quadratureMean, quadratureVariance, principalSpreads, wigner, wignerGrid, W_MAX,
  samplePoint, meanPhotons, squeezeDb, rFromDb, lossyVariance, photonDistribution, poisson, squeezedVacuumPhotons,
  photonMoments, phaseResolution,
} from '../quantumoptics/states.js';
import { Rng, sample, photocurrent, VarianceRecord, noiseDb, phaseMeasurement } from '../quantumoptics/homodyne.js';
import {
  DEFAULTS, NO_SQUEEZE, quantumNoise, noiseBudget, sqlFrequency, darkPortPhase, shotNoisePhase, chirpMass, iscoFrequency,
  timeToMerger, chirpFrequency, chirpSignal, chirpSpectrum, matchedFilterSnr, spaSnr, MPC, C, HBAR, G, MSUN,
} from '../quantumoptics/ligo.js';
import { gaussianWigner } from '../phasespace/states.js';
import { fft } from '../lib/fft.js';

const DEG = Math.PI / 180;

// ------------------------------------------------------------------ the quadrature plane

test('Quadratures: the vacuum is a round cloud of radius 1/2 and the coherent state the same cloud at α', () => {
  const vac = gaussianState({});
  close(Math.sqrt(quadratureVariance(vac, 0)), 0.5, 1e-15, 'ΔX1 of the vacuum');
  close(Math.sqrt(quadratureVariance(vac, 1.1)), 0.5, 1e-15, 'ΔX_θ of the vacuum');
  const coh = gaussianState({ x1: 2, x2: -1 });
  close(quadratureMean(coh, 0), 2, 1e-15, '⟨X1⟩'); close(quadratureMean(coh, Math.PI / 2), -1, 1e-15, '⟨X2⟩');
  close(quadratureVariance(coh, 0.7), 0.25, 1e-15, 'the same noise as the vacuum');
  close(meanPhotons(coh), 5, 1e-12, '⟨n⟩ = |α|²');
  close(meanPhotons(vac), 0, 1e-12, 'no photons in the vacuum');
  return 'ΔX = 1/2, ⟨n⟩ = |α|² = 5';
});

test('Wigner: a Gaussian state\'s W is normalised, peaks at 2/π, and its second moments are the covariance', () => {
  let worst = 0;
  for (const p of [{ x1: 0.5, x2: -0.3, r: 0.8, psi: 0.6 }, { x1: -1, x2: 2, r: 0, psi: 0 }, { x1: 1, x2: 1, r: 1.15, psi: 90 * DEG, eta: 0.6 }]) {
    const st = gaussianState(p), n = 601, ext = 9, W = wignerGrid(st, n, ext), step = (2 * ext) / (n - 1);
    let s = 0, m1 = 0, m2 = 0, c11 = 0, c12 = 0, c22 = 0;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const X1 = -ext + i * step, X2 = -ext + j * step, w = W[j * n + i] * step * step;
      s += w; m1 += X1 * w; m2 += X2 * w;
    }
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const u = -ext + i * step - st.x1, v = -ext + j * step - st.x2, w = W[j * n + i] * step * step;
      c11 += u * u * w; c12 += u * v * w; c22 += v * v * w;
    }
    worst = Math.max(worst, Math.abs(s - 1), Math.abs(m1 - st.x1), Math.abs(m2 - st.x2), Math.abs(c11 - st.s11), Math.abs(c12 - st.s12), Math.abs(c22 - st.s22));
    close(wigner(st, st.x1, st.x2), 1 / (2 * Math.PI * Math.sqrt(st.s11 * st.s22 - st.s12 ** 2)), 1e-12, 'the peak');
    if (p.eta === undefined) close(wigner(st, st.x1, st.x2), W_MAX, 1e-12, 'a pure state peaks at 2/π');
    close(wignerGrid(st, 5, 1)[12], wigner(st, 0, 0), 1e-9, 'the grid\'s middle is W(0, 0)');
  }
  assert(worst < 1e-6, `moments off by ${worst}`);
  return `normalisation and moments to ${worst.toExponential(1)}`;
});

test('Wigner: the same picture as the phase-space demo\'s, with x = √2 X1, p = √2 X2 and W(x, p) = W(X1, X2)/2', () => {
  let worst = 0;
  for (const p of [{ x1: 1.2, x2: -0.4, r: 0.5, psi: 0.3 }, { x1: 0, x2: 0, r: 0, psi: 0 }]) {
    const st = gaussianState(p);
    for (const [X1, X2] of [[0, 0], [1, -0.5], [0.3, 0.9], [-1.5, 0.2]]) {
      const ours = wigner(st, X1, X2);
      const theirs = gaussianWigner(Math.SQRT2 * X1, Math.SQRT2 * X2, { x0: Math.SQRT2 * p.x1, p0: Math.SQRT2 * p.x2, r: p.r, theta: p.psi });
      worst = Math.max(worst, Math.abs(ours / 2 - theirs));
    }
  }
  assert(worst < 1e-12, `differ by ${worst}`);
  return `agree to ${worst.toExponential(1)}`;
});

test('Squeezing: ΔX = e^{−r}/2 along ψ and e^{r}/2 across it, the product kept at 1/4; 10 dB is r = 1.151', () => {
  const r = 0.9, psi = 35 * DEG, st = gaussianState({ r, psi });
  close(Math.sqrt(quadratureVariance(st, psi)), Math.exp(-r) / 2, 1e-15, 'along ψ');
  close(Math.sqrt(quadratureVariance(st, psi + Math.PI / 2)), Math.exp(r) / 2, 1e-15, 'across ψ');
  const sp = principalSpreads(st);
  close(sp.min * sp.max, 0.25, 1e-15, 'the product'); close(sp.angle, psi, 1e-12, 'the narrow axis');
  close(Math.sqrt(st.s11 * st.s22 - st.s12 ** 2), 0.25, 1e-15, '√det Σ = 1/4');
  close(rFromDb(10), 1.1513, 1e-4, '10 dB'); close(squeezeDb(1), 8.686, 1e-3, 'r = 1 is 8.69 dB');
  // Turning the state turns its narrow axis with it, and a phase shift is such a turn.
  const t = rotated(st, 0.4);
  close(principalSpreads(t).angle, psi + 0.4, 1e-12, 'turned');
  close(quadratureVariance(t, psi + 0.4), Math.exp(-2 * r) / 4, 1e-15, 'still squeezed along it');
  const c = covariance(0, 0);
  close(c.s11 + c.s22, 0.5, 1e-15, 'r = 0 is the vacuum');
  return `ΔX_ψ = ${(Math.exp(-r) / 2).toFixed(4)}, ΔX_⊥ = ${(Math.exp(r) / 2).toFixed(4)}`;
});

test('Homodyne: the variance against θ is (e^{−2r} cos²(θ−ψ) + e^{2r} sin²(θ−ψ))/4, flat 1/4 for coherent states', () => {
  const r = 0.7, psi = 20 * DEG, st = gaussianState({ x1: 1.5, x2: 0.5, r, psi }), coh = gaussianState({ x1: 1.5, x2: 0.5 });
  let worst = 0;
  for (let th = 0; th < 2 * Math.PI; th += 0.05) {
    const exact = (Math.exp(-2 * r) * Math.cos(th - psi) ** 2 + Math.exp(2 * r) * Math.sin(th - psi) ** 2) / 4;
    worst = Math.max(worst, Math.abs(photocurrent(st, th).variance - exact), Math.abs(photocurrent(coh, th).variance - 0.25));
    close(photocurrent(st, th).mean, 1.5 * Math.cos(th) + 0.5 * Math.sin(th), 1e-12, 'the mean is ⟨X_θ⟩');
  }
  assert(worst < 1e-14, `off by ${worst}`);
  close(noiseDb(0.25), 0, 1e-12, 'the vacuum is 0 dB');
  close(noiseDb(Math.exp(-2 * r) / 4), -squeezeDb(r), 1e-9, 'the squeezed quadrature reads −r in dB');
  return `to ${worst.toExponential(1)}; r = 0.7 reads ${noiseDb(Math.exp(-2 * r) / 4).toFixed(2)} dB`;
});

test('Homodyne: the sampled photocurrent has the state\'s mean and variance, and the record bins it by θ', () => {
  const st = gaussianState({ x1: 2, r: 0.8, psi: 90 * DEG }), rng = new Rng(7), rec = new VarianceRecord(36);
  for (const th of [0, 90 * DEG, 45 * DEG]) {
    let s = 0, s2 = 0;
    const N = 40000;
    for (let i = 0; i < N; i++) { const x = sample(st, th, rng); s += x; s2 += x * x; rec.add(th, x); }
    const mean = s / N, v = s2 / N - mean * mean, ex = photocurrent(st, th);
    close(mean, ex.mean, 4 * Math.sqrt(ex.variance / N) + 1e-9, `mean at θ = ${th}`);
    close(v, ex.variance, 0.03 * ex.variance, `variance at θ = ${th}`);
    const b = rec.stats(rec.bin(th));
    close(b.variance, v, 1e-3 * v, 'the record\'s variance');
    assert(b.n === N, 'all samples in one bin');
  }
  assert(rec.stats(rec.bin(135 * DEG)) === null, 'an empty bin');
  assert(rec.count === 120000, 'the count');
  // The points drawn from the cloud have the same covariance.
  let c11 = 0, c22 = 0, c12 = 0;
  const N = 40000;
  for (let i = 0; i < N; i++) { const [a, b] = samplePoint(st, () => rng.gauss()); const u = a - st.x1, v = b - st.x2; c11 += u * u; c22 += v * v; c12 += u * v; }
  close(c11 / N, st.s11, 0.03 * st.s11, 'cloud s11'); close(c22 / N, st.s22, 0.03 * st.s22, 'cloud s22'); close(c12 / N, st.s12, 0.03 * Math.sqrt(st.s11 * st.s22), 'cloud s12');
  return 'means and variances within 3% from 40000 samples';
});

test('Loss: η mixes the vacuum back in, V = η e^{−2r} + 1 − η in vacuum units; 10 dB through 50% loss reads 2.6 dB', () => {
  for (const [r, eta] of [[1.151, 0.5], [0.7, 0.8], [2, 0.3]]) {
    const st = gaussianState({ r, psi: 0, eta });
    close(4 * quadratureVariance(st, 0), lossyVariance(r, eta), 1e-12, 'the squeezed quadrature');
    close(4 * quadratureVariance(st, Math.PI / 2), eta * Math.exp(2 * r) + 1 - eta, 1e-12, 'the anti-squeezed one');
    assert(principalSpreads(st).min * principalSpreads(st).max > 0.25, 'a mixed state has a bigger product');
  }
  const d = -10 * Math.log10(lossyVariance(rFromDb(10), 0.5));
  close(d, 2.6, 0.05, '10 dB through 50% loss');
  const st = gaussianState({ x1: 3, r: 1, eta: 0.4 });
  close(meanPhotons(st), 0.4 * (9 + Math.sinh(1) ** 2), 1e-9, '⟨n⟩ scales with η');
  return `10 dB through 50% loss: ${d.toFixed(2)} dB`;
});

// --------------------------------------------------------------------- photon statistics

test('Photons: a coherent state\'s numbers are Poisson with mean |α|² and the squeezed vacuum\'s are even only, mean sinh²r', () => {
  const P = photonDistribution({ x1: 1.5, x2: -2 }, 60), Q = poisson(6.25, 60);
  let worst = 0;
  for (let n = 0; n <= 60; n++) worst = Math.max(worst, Math.abs(P[n] - Q[n]));
  assert(worst < 1e-12, `Poisson off by ${worst}`);
  const m = photonMoments(P);
  close(m.mean, 6.25, 1e-9, 'mean'); close(m.sd, 2.5, 1e-9, 'Δn = |α|');
  for (const r of [0.5, 1.151, 1.6]) {
    const S = photonDistribution({ r, psi: 0.3 }, 240), T = squeezedVacuumPhotons(r, 240);
    let w = 0, odd = 0;
    for (let n = 0; n <= 240; n++) { w = Math.max(w, Math.abs(S[n] - T[n])); if (n % 2) odd += S[n]; }
    assert(w < 1e-8, `squeezed vacuum off by ${w} at r = ${r}`);
    assert(odd === 0, 'no odd numbers');
    close(photonMoments(S).mean, Math.sinh(r) ** 2, 2e-3 * Math.sinh(r) ** 2 + 1e-6, `⟨n⟩ = sinh²r at r = ${r}`);
  }
  return `Poisson to ${worst.toExponential(1)}; the squeezed vacuum's ⟨n⟩ = sinh²r`;
});

test('Photons: a displaced squeezed state has ⟨n⟩ = |α|² + sinh²r and Δn² = |α|²(e^{−2r}cos²ψ + e^{2r}sin²ψ) + 2 sinh²r cosh²r', () => {
  for (const [a, r, psi] of [[2, 0.6, 0], [2, 0.6, 90 * DEG], [3, 0.4, 30 * DEG], [1, 1.151, 90 * DEG]]) {
    const P = photonDistribution({ x1: a, r, psi }, 160), m = photonMoments(P);
    const ex = a * a + Math.sinh(r) ** 2, exv = a * a * (Math.exp(-2 * r) * Math.cos(psi) ** 2 + Math.exp(2 * r) * Math.sin(psi) ** 2) + 2 * Math.sinh(r) ** 2 * Math.cosh(r) ** 2;
    close(m.mean, ex, 1e-6 * ex, `⟨n⟩ at |α| = ${a}, r = ${r}, ψ = ${psi}`);
    close(m.sd ** 2, exv, 1e-5 * exv, `Δn² at |α| = ${a}, r = ${r}, ψ = ${psi}`);
    close(meanPhotons(gaussianState({ x1: a, r, psi })), ex, 1e-12, 'the Gaussian\'s ⟨n⟩ agrees');
  }
  const sub = photonMoments(photonDistribution({ x1: 3, r: 0.7, psi: 0 }, 160)), sup = photonMoments(photonDistribution({ x1: 3, r: 0.7, psi: 90 * DEG }, 160));
  assert(sub.sd < Math.sqrt(sub.mean) && sup.sd > Math.sqrt(sup.mean), 'amplitude-squeezed is sub-Poissonian, phase-squeezed super-Poissonian');
  // Loss thins the photons binomially: ⟨n⟩ → η⟨n⟩, and the squeezed vacuum gets odd numbers.
  const L = photonDistribution({ r: 1, eta: 0.7 }, 120), lm = photonMoments(L);
  close(lm.mean, 0.7 * Math.sinh(1) ** 2, 1e-3, '⟨n⟩ through loss');
  assert(L[1] > 0.01, 'odd numbers appear through loss');
  return `amplitude-squeezed |α| = 3, r = 0.7: Δn = ${sub.sd.toFixed(3)} (Poisson ${Math.sqrt(sub.mean).toFixed(3)}); phase-squeezed ${sup.sd.toFixed(3)}`;
});

// ------------------------------------------------------------------ measuring a phase

test('Phase measurement: a shift φ moves the cloud by |α|φ; Δφ_min = 1/(2|α|) for the coherent state, e^{−r}/(2|α|) squeezed', () => {
  const a = 3, phi = 0.05;
  const coh = gaussianState({ x1: a }), sq = gaussianState({ x1: a, r: 1.151, psi: 90 * DEG });
  const mc = phaseMeasurement(rotated(coh, phi), coh, Math.PI / 2), ms = phaseMeasurement(rotated(sq, phi), sq, Math.PI / 2);
  close(mc.shift, a * Math.sin(phi), 1e-12, 'the shift'); close(mc.noise, 0.5, 1e-12, 'the coherent noise');
  close(mc.minimum, phaseResolution(a), 1e-12, 'the SQL'); close(phaseResolution(a), 1 / (2 * a), 1e-15, '1/(2|α|)');
  close(ms.minimum, phaseResolution(a, 1.151), 1e-12, 'squeezed');
  close(ms.noise, Math.sqrt((Math.exp(-2 * 1.151) * Math.cos(phi) ** 2 + Math.exp(2 * 1.151) * Math.sin(phi) ** 2) / 4), 1e-12, 'the turned ellipse leaks a little of its wide side');
  assert(ms.snr > 2.5 * mc.snr, 'squeezing improves the signal-to-noise ratio');
  // The same SNR with 10 dB needs a tenth of the photons (for a shift small enough that the
  // turned ellipse's wide side does not leak in: 1% at φ = 0.01, 25% at 0.05).
  const few = gaussianState({ x1: a / Math.sqrt(10), r: 1.151, psi: 90 * DEG }), small = 0.01;
  close(phaseMeasurement(rotated(few, small), few, Math.PI / 2).snr / phaseMeasurement(rotated(coh, small), coh, Math.PI / 2).snr, 1, 0.01, 'a tenth of the light, the same SNR');
  return `SNR ${mc.snr.toFixed(3)} coherent, ${ms.snr.toFixed(3)} with 10 dB; Δφ_min ${mc.minimum.toFixed(4)} and ${ms.minimum.toFixed(4)} rad`;
});

// ------------------------------------------------------------------------------- LIGO

test('LIGO: shot noise ∝ 1/√P and radiation pressure ∝ √P, their product the SQL; the curve touches h_SQL where K = 1', () => {
  const f = 100;
  const a = quantumNoise(f, { ...DEFAULTS, P: 1e5 }), b = quantumNoise(f, { ...DEFAULTS, P: 4e5 });
  close(a.shot / b.shot, 4, 1e-12, 'shot noise power ∝ 1/P'); close(b.rp / a.rp, 4, 1e-12, 'radiation pressure power ∝ P');
  close(Math.sqrt(a.shot * a.rp), a.sql / 2, 1e-12 * a.sql, '√(shot × rp) = h_SQL²/2');
  // The envelope: over all powers, the least quantum noise at f is h_SQL².
  let least = Infinity, at = 0;
  for (let lp = 3; lp <= 9; lp += 0.002) { const q = quantumNoise(f, { ...DEFAULTS, P: 10 ** lp }); if (q.quantum < least) { least = q.quantum; at = 10 ** lp; } }
  close(least, a.sql, 1e-5 * a.sql, 'the envelope');
  close(quantumNoise(f, { ...DEFAULTS, P: at }).K, 1, 0.01, 'touched where K = 1');
  const fs = sqlFrequency(DEFAULTS);
  close(quantumNoise(fs, DEFAULTS).K, 1, 1e-9, 'sqlFrequency finds K = 1');
  assert(fs > 30 && fs < 150, `the SQL touch at ${fs.toFixed(1)} Hz`);
  close(Math.sqrt(a.sql), Math.sqrt((8 * HBAR) / (DEFAULTS.M * (2 * Math.PI * f) ** 2 * DEFAULTS.L ** 2)), 1e-30, 'h_SQL');
  // The shape: shot noise flat below f_c and ∝ f above it; radiation pressure ∝ 1/f² below.
  const s10 = Math.sqrt(quantumNoise(10, DEFAULTS).shot), s4k = Math.sqrt(quantumNoise(4000, DEFAULTS).shot), s40 = Math.sqrt(quantumNoise(40, DEFAULTS).shot);
  close(s40 / s10, 1, 0.01, 'flat below f_c'); close(s4k / Math.sqrt(quantumNoise(2000, DEFAULTS).shot), 2, 0.03, '∝ f above it');
  close(Math.sqrt(quantumNoise(5, DEFAULTS).rp) / Math.sqrt(quantumNoise(10, DEFAULTS).rp), 4, 0.01, 'radiation pressure ∝ 1/f²');
  return `SQL touched at ${fs.toFixed(1)} Hz with ${DEFAULTS.P / 1e3} kW; √S_shot = ${Math.sqrt(b.shot).toExponential(2)} at 100 Hz`;
});

test('LIGO: a phase-squeezed vacuum at the dark port lowers shot noise by e^{−2r} and raises radiation pressure by e^{2r}; frequency-dependent squeezing lowers everything', () => {
  const sq = { on: true, dB: 10, angle: 90, eta: 1, fd: false }, fd = { ...sq, fd: true };
  const r = rFromDb(10);
  for (const f of [8, 30, 100, 1000]) {
    const v = quantumNoise(f), s = quantumNoise(f, DEFAULTS, sq), d = quantumNoise(f, DEFAULTS, fd);
    close(s.shot / v.shot, Math.exp(-2 * r), 1e-12, `shot at ${f} Hz`);
    close(s.rp / v.rp, Math.exp(2 * r), 1e-12, `rp at ${f} Hz`);
    close(s.cross, 0, 1e-60, 'no cross term for phase squeezing');
    close(d.quantum / v.quantum, Math.exp(-2 * r), 1e-9, `frequency-dependent at ${f} Hz`);
    close(d.lambda, d.chi, 1e-12, 'the filter cavity sets the angle to the readout\'s');
  }
  // Below the SQL frequency phase squeezing makes things worse, above it better.
  const fs = sqlFrequency();
  assert(quantumNoise(fs / 4, DEFAULTS, sq).quantum > quantumNoise(fs / 4).quantum, 'worse at low frequency');
  assert(quantumNoise(4 * fs, DEFAULTS, sq).quantum < quantumNoise(4 * fs).quantum, 'better at high frequency');
  // Amplitude squeezing does the opposite; and the readout angle goes from 90° to 180° as K grows.
  const amp = { ...sq, angle: 0 };
  assert(quantumNoise(4 * fs, DEFAULTS, amp).shot > quantumNoise(4 * fs).shot && quantumNoise(fs / 4, DEFAULTS, amp).rp < quantumNoise(fs / 4).rp, 'amplitude squeezing');
  close(quantumNoise(5000).chi, 90, 0.5, 'phase quadrature at high frequency'); assert(quantumNoise(3).chi > 170, 'amplitude quadrature at low frequency');
  // Loss: 6 dB through 35% loss reads about 2.9 dB; the observed reduction never beats the loss.
  const lossy = { on: true, dB: 6, angle: 90, eta: 0.65, fd: false }, f = 2000;
  const gain = -10 * Math.log10(quantumNoise(f, DEFAULTS, lossy).shot / quantumNoise(f).shot);
  close(gain, 2.9, 0.1, '6 dB through 35% loss');
  const huge = -10 * Math.log10(quantumNoise(f, DEFAULTS, { ...lossy, dB: 30 }).shot / quantumNoise(f).shot);
  close(huge, -10 * Math.log10(0.35), 0.1, '30 dB through 35% loss gives only −10 log(1 − η)');
  return `6 dB through 35% loss: ${gain.toFixed(2)} dB of shot noise; the SQL touch is at ${fs.toFixed(0)} Hz`;
});

test('LIGO: the budget adds in power, the seismic wall is below 10 Hz, and a strain of 1e−21 is 4.7e−11 rad at the dark port', () => {
  const b = noiseBudget(100);
  close(b.total, b.quantum + b.seismic + b.thermal, 1e-60, 'the sum');
  assert(Math.sqrt(b.total) > 2e-24 && Math.sqrt(b.total) < 5e-24, `LIGO-like at 100 Hz: ${Math.sqrt(b.total).toExponential(2)}`);
  assert(Math.sqrt(noiseBudget(8).seismic) > 1e-23 && Math.sqrt(noiseBudget(12).seismic) < 1e-24, 'the wall');
  close(darkPortPhase(1e-21), 4.73e-11, 0.01e-11, 'the phase');
  close(shotNoisePhase(1e5), Math.sqrt(1.87e-19 / 2e5), 1e-14, '√(ħω/2P)');
  return `√S_total(100 Hz) = ${Math.sqrt(b.total).toExponential(2)} /√Hz`;
});

test('Chirp: f(t) follows the Newtonian formula, the duration from f_min to the ISCO is τ(f_min) − τ(f_ISCO), and the FFT\'s SNR matches the stationary phase', () => {
  const mc = chirpMass(1.4, 1.4), fisco = iscoFrequency(1.4, 1.4);
  close(mc, 1.2188, 1e-3, 'the chirp mass of 1.4 + 1.4');
  close(fisco, 1570, 5, 'the ISCO of 2.8 solar masses');
  const d = 40 * MPC, s = chirpSignal(mc, d, 70, fisco, 8192);
  close(s.tc - timeToMerger(fisco, mc), s.n * s.dt, 2 * s.dt, 'the duration');
  assert(s.tc > 4 && s.tc < 7, `from 70 Hz, ${s.tc.toFixed(2)} s to merger`);
  // The phase's rate is 2π f: count the zero crossings over a stretch and compare.
  let crossings = 0, i0 = Math.floor(0.2 * s.n), i1 = Math.floor(0.3 * s.n);
  for (let i = i0 + 1; i < i1; i++) if ((s.h[i - 1] < 0) !== (s.h[i] < 0)) crossings++;
  let fm = 0;
  for (let i = i0; i < i1; i++) fm += s.f[i];
  fm /= i1 - i0;
  close(crossings / (2 * (i1 - i0) * s.dt), fm, 0.02 * fm, 'the zero crossings count 2f per second');
  close(s.f[0], 70, 0.1, 'starts at f_min');
  close(chirpFrequency(timeToMerger(300, mc), mc), 300, 1e-6, 'τ(f) and f(τ) are inverses');
  // The SNR in LIGO's noise, by the FFT and by the closed form.
  const Sn = (f) => noiseBudget(f).total;
  const r = matchedFilterSnr(s.h, s.dt, Sn, fft, { fmin: 70, fmax: fisco }), rho = spaSnr(mc, d, Sn, 70, fisco);
  close(r.snr / rho, 1, 0.04, `FFT ${r.snr.toFixed(2)} against stationary phase ${rho.toFixed(2)}`);
  // Its spectrum is the f^{−7/6} law.
  const k = Math.round(200 / r.spectrum.df);
  close(r.spectrum.mag[k] / chirpSpectrum(r.spectrum.f[k], mc, d), 1, 0.05, '|h̃(200 Hz)|');
  // With 10 dB of frequency-dependent squeezing the SNR of the same chirp grows.
  const Ssq = (f) => noiseBudget(f, DEFAULTS, { on: true, dB: 10, angle: 90, eta: 1, fd: true }).total;
  const r2 = matchedFilterSnr(s.h, s.dt, Ssq, fft, { fmin: 70, fmax: fisco, spectrum: r.spectrum });
  assert(r2.snr > 1.5 * r.snr, 'squeezing raises the SNR');
  return `1.4 + 1.4 at 40 Mpc from 70 Hz: ${s.tc.toFixed(2)} s, SNR ${r.snr.toFixed(1)} (SPA ${rho.toFixed(1)}), ${r2.snr.toFixed(1)} with 10 dB`;
});

test('Chirp: GW150914-like numbers, h ~ 1e−21 at 100 Hz from 410 Mpc', () => {
  const mc = chirpMass(36, 29);
  close(mc, 28.1, 0.2, 'the chirp mass');
  const a = chirpSignal(mc, 410 * MPC, 20, iscoFrequency(36, 29), 4096);
  assert(a.tc > 0.7 && a.tc < 1.0, `${a.tc.toFixed(2)} s from 20 Hz to the ISCO`);
  const amp = Math.sqrt(2 * a.h.slice(-50).reduce((s, v) => s + v * v, 0) / 50);
  assert(amp > 3e-22 && amp < 3e-21, `amplitude near the end ${amp.toExponential(2)}`);
  return `Mc = ${mc.toFixed(1)}, ${a.tc.toFixed(2)} s, h ≈ ${amp.toExponential(1)} at the ISCO (${iscoFrequency(36, 29).toFixed(0)} Hz)`;
});
