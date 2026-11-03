import { test, assert, close } from './harness.js';
import {
  GAMMA, GAMMA_HZ, rotate, precess, relax, integrate, effectiveField, pulseDuration, pulseField, pulse,
  toLab, toRotating, spinHalf, lorentzianOffsets, spreadT2, T2star, Ensemble, adiabaticity, switchOff, polarized,
} from '../nmr/bloch.js';
import { Record, Rng, meanGauss, rms, noiseRms, rawColumns, spectrum, fitShape } from '../nmr/signal.js';
import { Engine } from '../nmr/engine.js';
import { buildSequence, runSequence, recoveryCurve, echoAmplitudes, echoCurve, polarizeCurve, leftAcross } from '../nmr/sequence.js';

const B0 = 5e6 / GAMMA_HZ;            // the TeachSpin's field: protons at 5 MHz
const B1 = pulseField(Math.PI / 2, 2.5e-6);   // a π/2 pulse in 2.5 μs
const norm = (v) => Math.hypot(v[0], v[1], v[2]);
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

// ----------------------------------------------------------------------- precession

test('a rotation keeps the length and turns the right way (left-handed about B for γ > 0)', () => {
  const v = [0.3, -0.4, 0.5], k = [1 / Math.sqrt(3), 1 / Math.sqrt(3), 1 / Math.sqrt(3)];
  const n0 = norm(v);
  for (let i = 0; i < 1000; i++) rotate(v, k, 0.7);
  close(norm(v), n0, 1e-12, 'length after 1000 rotations');
  // dM/dt = γ M × B with B along z takes x̂ towards −ŷ: clockwise seen from +z.
  const m = precess([1, 0, 0], [0, 0, B0], 1e-9);
  assert(m[1] < 0 && m[0] > 0.99, `x̂ after 1 ns in B0 ẑ: ${m}`);
  close(Math.atan2(m[1], m[0]), -GAMMA * B0 * 1e-9, 1e-15, 'the angle turned');
  return `M × B turns x̂ by ${(GAMMA * B0 * 1e-9).toExponential(3)} rad towards −ŷ in 1 ns at 5 MHz`;
});

test('precession at γB0: the phase after 100.3 periods, by the engine and by stepping, to 1e-6', () => {
  const T = 1 / (GAMMA_HZ * B0), t = 100.3 * T;
  // The engine keeps M in the frame rotating at ω_ref = γB0: the lab vector is turned back.
  const e = new Engine({ B0, N: 1 });
  e.reset([1, 0, 0], 0);
  e.advance(t);
  const lab = e.sum('lab');
  close(wrap(Math.atan2(lab[1], lab[0]) + GAMMA * B0 * t), 0, 1e-6, 'phase from the engine');
  // Stepping the lab-frame equation itself, 32 steps a period.
  const m = integrate([1, 0, 0], () => [0, 0, B0], 0, t, { perPeriod: 32 });
  close(wrap(Math.atan2(m[1], m[0]) + GAMMA * B0 * t), 0, 1e-6, 'phase by stepping');
  close(norm(m), 1, 1e-12, 'length');
  // f = γB/2π: the two instruments.
  close(GAMMA_HZ * 46.03e-6, 1959.8, 0.1, 'the Earth\'s field at Claremont');
  return `f = γB/2π: 5.000 MHz at ${(B0 * 1e3).toFixed(2)} mT, ${(GAMMA_HZ * 46.03e-6).toFixed(1)} Hz at 46.03 μT; 100.3 turns to 1e-6 rad`;
});

// ---------------------------------------------------------------------------- pulses

test('a π/2 pulse about x takes ẑ to +ŷ′, a π pulse to −ẑ; the lab-frame field integrated agrees to 1e-4', () => {
  const m = pulse([0, 0, 1], Math.PI / 2, 0, B1);
  close(m[1], 1, 1e-12, 'π/2 about x: My'); close(m[2], 0, 1e-12, 'π/2 about x: Mz');
  const p = pulse([0, 0, 1], Math.PI, 0, B1);
  close(p[2], -1, 1e-12, 'π: Mz');
  const y = pulse([0, 0, 1], Math.PI / 2, Math.PI / 2, B1);
  close(y[0], -1, 1e-12, 'π/2 about y: Mx');
  close(pulseDuration(Math.PI / 2, B1), 2.5e-6, 1e-18, 'duration');
  // The same pulse as a field rotating at γB0 in the lab frame, stepped 128 times a period.
  const w = GAMMA * B0, tau = pulseDuration(Math.PI / 2, B1);
  const lab = integrate([0, 0, 1], (t) => [B0, 0, 0].map((_, i) => [B1 * Math.cos(w * t), -B1 * Math.sin(w * t), B0][i]), 0, tau, { perPeriod: 128 });
  const back = toRotating(lab, w, tau);
  close(back[1], 1, 1e-4, 'lab frame, My′'); close(back[2], 0, 1e-4, 'lab frame, Mz');
  close(Math.acos(Math.max(-1, Math.min(1, lab[2]))), Math.PI / 2, 1e-4, 'the flip angle from the lab frame');
  return `θ = γB1τ: ${(B1 * 1e3).toFixed(4)} mT for 2.5 μs; the lab-frame integration gives θ = ${(Math.acos(lab[2]) * 180 / Math.PI).toFixed(4)}°`;
});

test('off resonance a pulse turns M about the tilted effective field, as the lab-frame integration shows', () => {
  const df = 100e3;                         // 100 kHz off, as large as γB1/2π: the field tilts 45°
  const Beff = effectiveField(B1, 0, df);
  close(Math.atan2(Beff[0], -Beff[2]), Math.PI / 4, 1e-9, 'the tilt of B_eff');
  const m = pulse([0, 0, 1], Math.PI / 2, 0, B1, df);
  assert(m[2] > 0.4, `a nominal π/2 leaves Mz = ${m[2].toFixed(3)} (not 0)`);
  const w = GAMMA * B0 + 2 * Math.PI * df, tau = pulseDuration(Math.PI / 2, B1);
  const lab = integrate([0, 0, 1], (t) => [B1 * Math.cos(w * t), -B1 * Math.sin(w * t), B0], 0, tau, { perPeriod: 128 });
  const back = toRotating(lab, w, tau);
  for (let i = 0; i < 3; i++) close(back[i], m[i], 2e-4, `component ${i}`);
  return `100 kHz off: B_eff tilted 45°, Mz after the "π/2" = ${m[2].toFixed(4)} (lab frame ${back[2].toFixed(4)})`;
});

// ------------------------------------------------------------------------- relaxation

test('T1 and T2 exponentials: after a π/2, Mxy = e^{−t/T2} and Mz = 1 − e^{−t/T1}', () => {
  const T1 = 0.03, T2 = 0.02, t = 0.01;
  const e = new Engine({ B0, N: 1, T1, T2 });
  e.reset([1, 0, 0], 0);
  e.setSampling(1e-4);
  e.advance(t);
  const m = e.sum('rot');
  close(Math.hypot(m[0], m[1]), Math.exp(-t / T2), 1e-12, 'Mxy');
  close(m[2], 1 - Math.exp(-t / T1), 1e-12, 'Mz');
  // Relaxation about another axis: along it with T1, across it with T2.
  const n = [0.6, 0, 0.8], v = relax([1, 0, 0], 1, 2, 0.5, 1, n);
  const along = v[0] * n[0] + v[2] * n[2], across = Math.hypot(v[0] - along * n[0], v[1], v[2] - along * n[2]);
  close(along, 1 + (0.6 - 1) * Math.exp(-0.5), 1e-12, 'along n'); close(across, 0.8 * Math.exp(-2), 1e-12, 'across n');
  // Off: infinite times leave M alone.
  const w = relax([0.3, 0.4, 0.5], 10, Infinity, Infinity);
  close(w[0], 0.3, 0, 'off');
  return `at t = 10 ms: Mxy = ${Math.exp(-t / T2).toFixed(4)} (T2 = 20 ms), Mz = ${(1 - Math.exp(-t / T1)).toFixed(4)} (T1 = 30 ms)`;
});

// --------------------------------------------------------------------------- ensembles

test('a Lorentzian spread of width Δf makes the FID decay as e^{−t/T2*}, T2* = 1/(πΔf), with no spin losing anything', () => {
  const N = 400, df = 500, T2s = spreadT2(df);
  close(T2s, 1 / (Math.PI * 500), 1e-18, 'T2′');
  const e = new Engine({ B0, N, spreadHz: df });
  e.reset([0, 1, 0], 0); e.setSampling(2e-5);
  let worst = 0;
  for (let t = 1e-4; t <= 1.5e-3; t += 1e-4) {
    e.advance(t - e.t);
    const m = e.sum('rot');
    worst = Math.max(worst, Math.abs(Math.hypot(m[0], m[1]) - Math.exp(-t / T2s)));
  }
  assert(worst < 0.012, `largest error of the FID against e^{−t/T2*}: ${worst}`);
  for (let i = 0; i < N; i += 37) close(norm(e.ens.get(i)), 1, 1e-12, `spin ${i} keeps its length`);
  close(T2star(0.02, 500), 1 / (1 / 0.02 + Math.PI * 500), 1e-18, '1/T2* = 1/T2 + πΔf');
  return `N = ${N}: |M| follows e^{−t/T2*} to ${worst.toFixed(4)} over 2.4 T2* (T2* = ${(T2s * 1e3).toFixed(3)} ms); every spin still has length 1`;
});

test('a π pulse at τ refocuses the spread into an echo at 2τ of height e^{−2τ/T2}', () => {
  const N = 400, df = 500, T2 = 0.02, tau = 5e-3;
  const seq = buildSequence('echo', tau, 1, T2star(T2, df));
  const e = runSequence({ B0, B1, N, spreadHz: df, T1: 0.03, T2 }, seq.pulses, 2 * tau + 2e-3, 1e-5);
  const peak = e.record.envelopeMax(2 * tau - 1e-3, 2 * tau + 1e-3);
  close(peak.t, 2 * tau, 2e-5, 'the echo is at 2τ');
  close(peak.max, Math.exp(-2 * tau / T2), 0.01, 'the echo\'s height');
  const before = e.record.envelopeMax(tau + 1e-3, 2 * tau - 1e-3).max;
  assert(before < 0.03, `between the π pulse and the echo the signal is gone: ${before}`);
  // Without the π pulse nothing comes back.
  const f = runSequence({ B0, B1, N, spreadHz: df, T1: 0.03, T2 }, [seq.pulses[0]], 2 * tau + 1e-3, 1e-5);
  assert(f.record.envelopeMax(2 * tau - 1e-3, 2 * tau + 1e-3).max < 0.02, 'no echo without the π pulse');
  // The same from the echo-against-τ run and its fit.
  const c = echoCurve({ B0, B1, N: 200, spreadHz: df, T1: 0.03, T2 }, [2e-3, 4e-3, 6e-3, 8e-3, 12e-3]);
  close(c.fit.T2, T2, 0.03 * T2, 'T2 fitted from echoes at five τ');
  return `echo at t = ${(peak.t * 1e3).toFixed(3)} ms, height ${peak.max.toFixed(4)} (e^{−2τ/T2} = ${Math.exp(-2 * tau / T2).toFixed(4)}); T2 from five echoes ${(c.fit.T2 * 1e3).toFixed(2)} ms`;
});

test('a CPMG train of π pulses about y gives echoes decaying with T2, and the fit finds it', () => {
  const T2 = 0.02, tau = 2e-3, n = 10;
  const seq = buildSequence('cpmg', tau, n, T2star(T2, 500));
  const e = runSequence({ B0, B1, N: 200, spreadHz: 500, T1: 0.03, T2 }, seq.pulses, seq.span, 1e-5);
  const ec = echoAmplitudes(e.record, seq.echoes, 5e-4);
  close(ec.fit.T2, T2, 0.03 * T2, 'T2 from the train');
  for (let k = 0; k < n; k++) close(ec.t[k], seq.echoes[k], 2e-5, `echo ${k + 1} at 2(k+1)τ`);
  return `${n} echoes, 4 to 40 ms: T2 = ${(ec.fit.T2 * 1e3).toFixed(2)} ms (set 20)`;
});

test('inversion recovery: M_z(τ) = 1 − 2e^{−τ/T1}, the null at T1 ln 2, and the fit finds T1', () => {
  const T1 = 0.03, taus = [2, 5, 10, 15, 20, 25, 30, 40, 50, 70, 90].map((ms) => ms * 1e-3);
  const c = recoveryCurve({ B0, B1, N: 1, T1, T2: 0.02 }, taus);
  let worst = 0;
  taus.forEach((tau, i) => { worst = Math.max(worst, Math.abs(c.amp[i] - (1 - 2 * Math.exp(-tau / T1)))); });
  assert(worst < 2e-3, `signed amplitude against 1 − 2e^{−τ/T1}: worst ${worst}`);
  close(c.fit.T1, T1, 0.01 * T1, 'T1 fitted'); close(c.fit.nullAt, T1 * Math.LN2, 1e-4, 'the null');
  return `T1 = ${(c.fit.T1 * 1e3).toFixed(2)} ms from eleven delays; the null at ${(c.fit.nullAt * 1e3).toFixed(2)} ms = T1 ln 2`;
});

// ---------------------------------------------------------------------------- spectrum

test('the FID\'s spectrum: a line at the Larmor frequency of width 1/(πT2*)', () => {
  // One spin with T2: an exact Lorentzian of width 1/(πT2).
  const T2 = 1e-3, e = new Engine({ B0, N: 1, T2, offsetHz: 2000 });   // the reference 2 kHz above
  e.reset([0, 1, 0], 0); e.setSampling(5e-6); e.advance(12e-3);
  const s = spectrum(e.record, 0, 12e-3, 0, 2048, 4);
  close(s.peak.f, -2000, s.df, 'the line is 2 kHz below the reference');
  close(s.fwhm, 1 / (Math.PI * T2), 0.02 / (Math.PI * T2), 'FWHM = 1/(πT2)');
  // An ensemble's spread: width 1/(πT2*) too.
  const f = new Engine({ B0, N: 400, spreadHz: 500 });
  f.reset([0, 1, 0], 0); f.setSampling(5e-6); f.advance(8e-3);
  const sf = spectrum(f.record, 0, 8e-3, 0, 2048, 4);
  close(sf.peak.f, 0, sf.df, 'on resonance'); close(sf.fwhm, 500, 15, 'FWHM = Δf');
  return `one spin, T2 = 1 ms: peak at ${s.peak.f.toFixed(1)} Hz, width ${s.fwhm.toFixed(1)} Hz (1/πT2 = ${(1 / (Math.PI * T2)).toFixed(1)}); 400 spins spread 500 Hz: width ${sf.fwhm.toFixed(1)} Hz`;
});

// ------------------------------------------------------------------------- the raw trace

test('the raw trace is the EMF: Vpk (Mx′ sin ωt − My′ cos ωt), drawn as an envelope when a column holds many periods', () => {
  const e = new Engine({ B0, N: 1 }), T = 1 / (GAMMA_HZ * B0);
  e.reset([1, 0, 0], 0); e.setSampling(T / 50); e.advance(40 * T);
  const fine = rawColumns(e.record, e.omegaRef, 0, T, 64);
  assert(!fine.envelope, 'one period in 64 columns is drawn as samples');
  close(Math.max(...fine.hi), 1, 0.01, 'the peak of one cycle'); close(Math.min(...fine.lo), -1, 0.01, 'its trough');
  close(fine.hi[16], 1, 0.02, 'sin ωt peaks a quarter period in');
  const coarse = rawColumns(e.record, e.omegaRef, 0, 40 * T, 8);
  assert(coarse.envelope && Math.abs(coarse.hi[3] - 1) < 1e-9 && Math.abs(coarse.lo[3] + 1) < 1e-9, 'five periods a column: ± the envelope');
  return `64 columns a period: samples, peak ${Math.max(...fine.hi).toFixed(3)}; 5 periods a column: the envelope ±1`;
});

// ---------------------------------------------------------------------------- the board

test('the switch-off: sudden when γBE²τ/Bp ≪ 1 (M left across the Earth\'s field), adiabatic when ≫ 1 (M follows down to ẑ)', () => {
  const Bp = 5.2249e-3 * 1.5, BE = 46.03e-6;
  const A = adiabaticity(Bp, BE, 0.4e-3);
  close(A, 0.0289, 5e-4, 'the board\'s 0.4 ms');
  const sudden = leftAcross(Bp, BE, 0.4e-3);
  assert(sudden.across > 0.995 && Math.abs(sudden.along) < 0.1, `0.4 ms: across ${sudden.across}, along ${sudden.along}`);
  const tauAd = 30 / (GAMMA * BE * BE / Bp);
  const adiabatic = leftAcross(Bp, BE, tauAd);
  assert(adiabatic.along > 0.99 && adiabatic.across < 0.15, `A = 30: across ${adiabatic.across}, along ${adiabatic.along}`);
  const mid = leftAcross(Bp, BE, 1 / (GAMMA * BE * BE / Bp));
  assert(mid.across > 0.3 && mid.across < 0.95, `A = 1: across ${mid.across}`);
  close(polarized(3, 2.5, Bp, BE), 1 - Math.exp(-1.2), 1e-4, 'polarized in 3 s with T1 = 2.5 s');
  return `A = ${A.toFixed(4)} at 0.4 ms: ${(sudden.across * 100).toFixed(1)}% left across; A = 30 (τ = ${(tauAd * 1e3).toFixed(0)} ms): ${(adiabatic.along * 100).toFixed(1)}% along ẑ; A = 1: ${(mid.across * 100).toFixed(0)}% across`;
});

test('the board\'s cycle in the engine: nothing while polarizing, then the FID at 1959.8 Hz fading with T2*, growing with the polarizing time as 1 − e^{−tp/T1}', () => {
  const Bp = 5.2249e-3 * 1.5, BE = 46.03e-6, T1 = 2.5, T2 = 2.0, spread = 0.213;   // 5 nT across the bottle
  const e = new Engine({ T1, T2, N: 100, spreadHz: spread });
  e.setSampling(2e-3);
  e.startEarth({ Bp, BE, tp: 3, ramp: 0.4e-3, tl: 2, tOpen: 0.019 });
  e.advance(1.5);
  let m = e.sum('lab');
  close(m[0], polarized(1.5, T1, Bp, BE), 1e-3, 'M along the coil after 1.5 s');
  assert(e.record.envelopeMax(0, 1.5).max === 0, 'the receiver is off while polarizing');
  e.advance(e.tEnd - e.t);
  assert(e.done, 'the cycle ends');
  const t0 = 3 + 0.4e-3 + 0.019, s = spectrum(e.record, t0, 5, 0, 2048, 4);
  close(s.peak.f, 0, s.df, 'the line at the Larmor frequency (the frame\'s)');
  close(e.f0, 1959.8, 0.1, 'f0');
  const amp0 = e.record.envelopeMax(t0, t0 + 0.05).max, amp1 = e.record.envelopeMax(t0 + 1, t0 + 1.05).max;
  const T2s = T2star(T2, spread);
  close(amp1 / amp0, Math.exp(-1 / T2s), 0.03, 'the FID fades with T2*');
  const c = polarizeCurve({ T1, T2, N: 1 }, { Bp, BE, ramp: 0.4e-3, tOpen: 0.019 }, [0.2, 0.5, 1, 1.5, 2, 3, 4, 4.7]);
  close(c.fit.T1, T1, 0.02 * T1, 'T1 from the polarizing time');
  return `after 3 s: ${(amp0).toFixed(3)} of full polarization (1 − e^{−3/2.5} = ${(1 - Math.exp(-1.2)).toFixed(3)}); T2* = ${T2s.toFixed(3)} s; T1 fitted ${c.fit.T1.toFixed(3)} s`;
});

// ------------------------------------------------------------------------------- noise

test('the noise is Gaussian with the r.m.s. asked for, and averaging N repeats divides it by √N', () => {
  const rng = new Rng(3), n = 100000, a = new Float64Array(n);
  let within = 0;
  for (let i = 0; i < n; i++) { a[i] = rng.gauss(); if (Math.abs(a[i]) < 1) within++; }
  close(rms(a), 1, 0.01, 'r.m.s. of unit noise');
  close(a.reduce((s, v) => s + v, 0) / n, 0, 0.01, 'mean');
  close(within / n, 0.6827, 0.006, 'the fraction within one sigma');
  const b = new Float64Array(20000);
  for (let i = 0; i < b.length; i++) b[i] = meanGauss(rng, 16);
  close(rms(b), 0.25, 0.01, 'the mean of 16 has r.m.s. 1/4');
  // In a record: the noise shown, in units of the signal's peak, is sigma/√averages.
  const R = new Record();
  for (let i = 0; i < 4000; i++) R.push(i * 1e-5, 0, 0, 0, rng, 1);
  const one = noiseRms(R, 0, 1, 0.2);
  R.renoise(rng, 25);
  const avg = noiseRms(R, 0, 1, 0.2);
  close(one, 0.2, 0.01, 'σ = 0.2 with no averaging'); close(one / avg, 5, 0.3, '25 averages: 5 times smaller');
  return `unit noise: r.m.s. ${rms(a).toFixed(4)}, ${(100 * within / n).toFixed(1)}% within 1σ; 16 averages: ${rms(b).toFixed(4)}; a record at σ = 0.2: ${one.toFixed(4)}, after 25 averages ${avg.toFixed(4)}`;
});

// ------------------------------------------------------------------------------ spin ½

test('the spin-½ state of the arrow: cos(θ/2)|↑⟩ + e^{iφ} sin(θ/2)|↓⟩', () => {
  const up = spinHalf([0, 0, 1]);
  close(up.up, 1, 1e-12, '|↑⟩'); close(up.down, 0, 1e-12, 'no |↓⟩');
  const x = spinHalf([1, 0, 0]);
  close(x.up, Math.SQRT1_2, 1e-12, 'x: equal'); close(x.phi, 0, 1e-12, 'x: φ = 0'); close(x.pUp, 0.5, 1e-12, 'P(↑) = ½');
  const my = spinHalf([0, -0.5, 0]);
  close(my.phi, -Math.PI / 2, 1e-12, '−y: φ = −π/2'); close(my.length, 0.5, 1e-12, 'a short arrow is not a pure state');
  const t = spinHalf([0, Math.sin(1), Math.cos(1)]);
  close(t.theta, 1, 1e-12, 'θ'); close(t.pUp, Math.cos(0.5) ** 2, 1e-12, 'P(↑) = cos²(θ/2)');
  return 'ẑ is |↑⟩; x̂ is (|↑⟩ + |↓⟩)/√2; the amplitudes follow θ and φ';
});

test('the engine: lab and rotating frames agree, pulses sent now queue after one another, the record has every pulse', () => {
  const e = new Engine({ B0, B1, N: 3, spreadHz: 1000 });
  e.reset([0, 0, 1], 0); e.setSampling(1e-6);
  e.pulseNow(90, 0); e.pulseNow(180, 90);
  assert(e.queue.length === 2 && e.queue[1].t === e.queue[0].t + 2.5e-6, 'the second pulse waits for the first');
  e.advance(10e-6);
  assert(e.sent.length === 2 && e.pulse === null, 'both sent and over');
  const rot = e.sum('rot'), lab = e.sum('lab'), back = toRotating(lab, e.omegaRef, e.t);
  for (let i = 0; i < 3; i++) close(back[i], rot[i], 1e-12, `frame ${i}`);
  close(norm(rot), 1, 1e-3, 'three spins spread 1 kHz for 10 μs are still together');
  // After π/2 about x then π about y: ŷ′ → ŷ′ (unchanged by a turn about y) up to the spread.
  close(rot[1], 1, 1e-3, 'M along y′');
  const R = e.record;
  assert(R.length > 10 && R.t[R.length - 1] === e.t, `the record reaches the clock (${R.length} samples)`);
  return `two pulses, 7.5 μs of them, in a 10 μs run of ${R.length} samples; |M| = ${norm(rot).toFixed(5)}`;
});

test('fitShape recovers a time constant from a rise, a decay and a recovery with noise on them', () => {
  const rng = new Rng(5), t = Array.from({ length: 30 }, (_, i) => (i + 1) * 0.01);
  const noisy = (f) => t.map((x) => f(x) + 0.02 * rng.gauss());
  const d = fitShape(t, noisy((x) => 0.8 * Math.exp(-x / 0.07)), 'decay');
  const r = fitShape(t, noisy((x) => 1.3 * (1 - Math.exp(-x / 0.12))), 'rise');
  const v = fitShape(t, noisy((x) => 0.9 * (1 - 2 * Math.exp(-x / 0.05))), 'recovery');
  close(d.tau, 0.07, 0.005, 'decay'); close(r.tau, 0.12, 0.012, 'rise'); close(v.tau, 0.05, 0.003, 'recovery');
  close(d.A, 0.8, 0.03, 'decay A'); close(r.A, 1.3, 0.05, 'rise A'); close(v.A, 0.9, 0.03, 'recovery A');
  return `τ = ${d.tau.toFixed(4)} (0.07), ${r.tau.toFixed(4)} (0.12), ${v.tau.toFixed(4)} (0.05) with noise of 0.02`;
});
