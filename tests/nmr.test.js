import { test, assert, close } from './harness.js';
import {
  GAMMA, GAMMA_HZ, rotate, precess, relax, integrate, effectiveField, pulseDuration, pulseField, pulse,
  toLab, toRotating, spinHalf, lorentzianOffsets, spreadT2, T2star, Ensemble, adiabaticity, switchOff, polarized,
} from '../nmr/bloch.js';
import { Record, Rng, meanGauss, rms, noiseRms, rawColumns, spectrum, fitShape } from '../nmr/signal.js';
import { Engine } from '../nmr/engine.js';
import { buildSequence, runSequence, startSequence, recoveryCurve, echoAmplitudes, echoCurve, polarizeCurve, leftAcross, threeClocks, clockFits, clockTrain } from '../nmr/sequence.js';
import {
  TANK, RECEIVER, K_B, bankC, switchesOn, codeFor, resonance, capacitanceFor, quality, tankWidth, tuneFor, tankH, filterH,
  noiseDensity, kTC, receiverNoise, synthOut,
} from '../nmr/receiver.js';

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
  const lab = integrate([0, 0, 1], (t) => [B1 * Math.cos(w * t), -B1 * Math.sin(w * t), B0], 0, tau, { perPeriod: 512 });
  const back = toRotating(lab, w, tau);
  close(back[1], 1, 1e-4, 'lab frame, My′'); close(back[2], 0, 1e-4, 'lab frame, Mz');
  close(Math.acos(Math.max(-1, Math.min(1, lab[2]))), Math.PI / 2, 1e-4, 'the flip angle from the lab frame');
  return `θ = γB1τ: ${(B1 * 1e3).toFixed(4)} mT for 2.5 μs; the lab-frame integration gives θ = ${(Math.acos(lab[2]) * 180 / Math.PI).toFixed(4)}°`;
});

test('off resonance a pulse turns M about the tilted effective field: the closed form, and the lab-frame integration', () => {
  // On resonance B1 turns M at ω1 = γB1; δf off, the frame leaves ΔB = −2πδf/γ along z, and M
  // turns about B_eff, tilted β from z with tan β = ω1/(−2πδf), at √(ω1² + (2πδf)²).  From ẑ:
  // Mz = cos²β + sin²β cos(√(1 + (2πδf/ω1)²) θ).
  const w1 = GAMMA * B1, rows = [];
  for (const df of [0, 10e3, 50e3, 100e3, 300e3]) {
    const Beff = effectiveField(B1, 0, df), beta = Math.atan2(Beff[0], Beff[2]);
    const m = pulse([0, 0, 1], Math.PI / 2, 0, B1, df);
    const k = Math.hypot(1, (2 * Math.PI * df) / w1), exact = Math.cos(beta) ** 2 + Math.sin(beta) ** 2 * Math.cos(k * Math.PI / 2);
    close(m[2], exact, 1e-12, `Mz at ${df / 1e3} kHz off`);
    rows.push(`${df / 1e3} kHz: Mz = ${m[2].toFixed(3)}`);
  }
  const df = 100e3, m = pulse([0, 0, 1], Math.PI / 2, 0, B1, df);
  close(Math.atan2(B1, (2 * Math.PI * df) / GAMMA), Math.PI / 4, 1e-12, '100 kHz off B_eff is tilted 45°');
  const w = GAMMA * B0 + 2 * Math.PI * df, tau = pulseDuration(Math.PI / 2, B1);
  const lab = integrate([0, 0, 1], (t) => [B1 * Math.cos(w * t), -B1 * Math.sin(w * t), B0], 0, tau, { perPeriod: 512 });
  const back = toRotating(lab, w, tau);
  for (let i = 0; i < 3; i++) close(back[i], m[i], 1e-4, `lab frame, component ${i}`);
  return `a nominal π/2 (ω1/2π = 100 kHz): ${rows.join(', ')}; the lab frame agrees to 1e-4`;
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
  const N = 4096, df = 500, T2s = spreadT2(df);
  close(T2s, 1 / (Math.PI * 500), 1e-18, 'T2′');
  const e = new Engine({ B0, N, spreadHz: df });
  e.reset([0, 1, 0], 0); e.setSampling(2e-5);
  let worst = 0;
  for (let t = 1e-4; t <= 1.5e-3; t += 1e-4) {
    e.advance(t - e.t);
    const m = e.sum('rot');
    worst = Math.max(worst, Math.abs(Math.hypot(m[0], m[1]) - Math.exp(-t / T2s)));
  }
  assert(worst < 0.01, `largest error of the FID against e^{−t/T2*}: ${worst}`);
  for (let i = 0; i < N; i += 371) close(norm(e.ens.get(i)), 1, 1e-12, `spin ${i} keeps its length`);
  close(T2star(0.02, 500), 1 / (1 / 0.02 + Math.PI * 500), 1e-18, '1/T2* = 1/T2 + πΔf');
  return `N = ${N}: |M| follows e^{−t/T2*} to ${worst.toFixed(4)} over 2.4 T2* (T2* = ${(T2s * 1e3).toFixed(3)} ms); every spin still has length 1`;
});

const B1hard = pulseField(Math.PI / 2, 0.25e-6);   // pulses 10 times shorter: hard for the whole line

test('a π pulse at τ refocuses the spread into an echo at 2τ of height e^{−2τ/T2}', () => {
  const N = 4096, df = 500, T2 = 0.02, tau = 5e-3, T2p = spreadT2(df);
  const seq = buildSequence('echo', tau, 1, T2star(T2, df));
  const e = runSequence({ B0, B1: B1hard, N, spreadHz: df, T1: 0.03, T2 }, seq.pulses, 2 * tau + 2e-3, 1e-5);
  const peak = e.record.envelopeMax(2 * tau - 1e-3, 2 * tau + 1e-3);
  close(peak.t, 2 * tau, 2e-5, 'the echo is at 2τ');
  close(peak.max, Math.exp(-2 * tau / T2), 1e-3, 'the echo\'s height');
  // The TeachSpin's 2.5 μs π/2 (ω1/2π = 100 kHz) misses the far tail of a Lorentzian line, and a
  // 25 μs one (10 kHz) misses more: their echoes are 0.4% and 2.8% lower.
  const soft = [B1, pulseField(Math.PI / 2, 25e-6)].map((b) => runSequence({ B0, B1: b, N, spreadHz: df, T1: 0.03, T2 }, seq.pulses, 2 * tau + 1e-4, 1e-5, 11, [[2 * tau - 1e-4, 2 * tau + 1e-4]]).record.envelopeMax(2 * tau - 1e-4, 2 * tau + 1e-4).max / Math.exp(-2 * tau / T2));
  assert(soft[0] > 0.993 && soft[0] < 0.999 && soft[1] > 0.96 && soft[1] < 0.98, `soft pulses refocus ${soft}`);
  // Its two sides are the FID's envelope, e^{−|t − 2τ|/T2′} (times the T2 loss).
  const side = e.record.envelopeMax(2 * tau + 0.5e-3 - 2e-5, 2 * tau + 0.5e-3 + 2e-5).max;
  close(side, Math.exp(-(2 * tau + 0.5e-3) / T2) * Math.exp(-0.5e-3 / T2p), 0.01, 'the echo\'s side 0.5 ms after it');
  // More than 4.7 T2′ from the echo, only the finite ensemble's floor is left.
  const before = e.record.envelopeMax(tau + 2e-4, 2 * tau - 3e-3).max;
  assert(before < 0.03, `between the π pulse and the echo the signal is gone: ${before}`);
  // Without the π pulse nothing comes back.
  const f = runSequence({ B0, B1: B1hard, N, spreadHz: df, T1: 0.03, T2 }, [seq.pulses[0]], 2 * tau + 1e-3, 1e-5);
  const none = f.record.envelopeMax(2 * tau - 1e-3, 2 * tau + 1e-3).max;
  assert(none < 0.03, `no echo without the π pulse: ${none}`);
  // The same from the echo-against-τ run and its fit.
  const c = echoCurve({ B0, B1, N, spreadHz: df, T1: 0.03, T2 }, [2e-3, 4e-3, 6e-3, 8e-3, 12e-3]);
  close(c.fit.T2, T2, 0.01 * T2, 'T2 fitted from echoes at five τ');
  return `echo at t = ${(peak.t * 1e3).toFixed(3)} ms, height ${peak.max.toFixed(4)} (e^{−2τ/T2} = ${Math.exp(-2 * tau / T2).toFixed(4)}); floor ${before.toFixed(3)} between; with 2.5 and 25 μs π/2 pulses ${soft.map((x) => x.toFixed(4)).join(' and ')} of it; T2 from five echoes ${(c.fit.T2 * 1e3).toFixed(2)} ms`;
});

test('a CPMG train of π pulses about y gives echoes decaying with T2, and the fit finds it', () => {
  const T2 = 0.02, tau = 2e-3, n = 10;
  const seq = buildSequence('cpmg', tau, n, T2star(T2, 500));
  const e = runSequence({ B0, B1: B1hard, N: 4096, spreadHz: 500, T1: 0.03, T2 }, seq.pulses, seq.span, 1e-5);
  const ec = echoAmplitudes(e.record, seq.echoes, 5e-4);
  for (let k = 0; k < n; k++) close(ec.amp[k], Math.exp(-seq.echoes[k] / T2), 2e-3, `echo ${k + 1}'s height`);
  close(ec.fit.T2, T2, 0.03 * T2, 'T2 from the train');
  for (let k = 0; k < n; k++) close(ec.t[k], seq.echoes[k], 2e-5, `echo ${k + 1} at 2(k+1)τ`);
  return `${n} echoes, 4 to 40 ms: T2 = ${(ec.fit.T2 * 1e3).toFixed(2)} ms (set 20)`;
});

// ------------------------------------------------------------------- the three clocks

// The page's made-up sample: T1 = 100 ms, T2 = 10 ms, and the Lorentzian spread that makes
// T2* = 1 ms (1/T2* = 1/T2 + πΔf), with the TeachSpin's 2.5 μs π/2.
const CK = { T1: 0.1, T2: 0.01, df: (1 / 1e-3 - 1 / 0.01) / Math.PI };
const logTimes = (a, b, r = 1.02) => { const out = []; for (let t = a; t <= b; t *= r) out.push(t); return out; };

test('three clocks after a π/2: the sum dies as e^{−t/T2*}, each spin\'s own part exactly as e^{−t/T2}, M_z exactly as 1 − e^{−t/T1}; the fits find 1, 10 and 100 ms', () => {
  close(T2star(CK.T2, CK.df), 1e-3, 1e-15, 'T2* of the sample');
  const P = { B0, B1, N: 4096, spreadHz: CK.df, T1: CK.T1, T2: CK.T2 };
  const c = threeClocks(P, logTimes(2e-6, 0.3));
  // Each spin's own part and M_z: exact exponentials from where the pulse left them (it tips the
  // line's far tails a little less: 0.9994 across, 0.0009 along z).
  const t0 = c.t[0], p0 = c.perp[0], z0 = c.mz[0];
  assert(p0 > 0.999 && p0 < 1 && z0 > 0 && z0 < 0.001, `after the pulse: mean |M⊥ᵢ| ${p0}, M_z ${z0}`);
  let wp = 0, wz = 0, ws = 0, over = -Infinity;
  c.t.forEach((t, i) => {
    wp = Math.max(wp, Math.abs(c.perp[i] - p0 * Math.exp(-(t - t0) / CK.T2)));
    wz = Math.max(wz, Math.abs(1 - c.mz[i] - (1 - z0) * Math.exp(-(t - t0) / CK.T1)));
    if (t >= 1e-4) ws = Math.max(ws, Math.abs(c.sig[i] - Math.exp(-t / 1e-3)));
    over = Math.max(over, c.sig[i] - c.perp[i]);
  });
  assert(wp < 1e-12 && wz < 1e-12, `mean |M⊥ᵢ| against e^{−t/T2}: ${wp}; 1 − M_z against e^{−t/T1}: ${wz}`);
  // The sum: e^{−t/T2*} but for a finite ensemble's residue, and never longer than the spins' mean.
  assert(ws < 0.005, `|ΣM⊥|/N against e^{−t/T2*} from 0.1 ms: ${ws}`);
  assert(over <= 1e-15, `the sum is never longer than the spins' own mean: ${over}`);
  const F = clockFits(c, { from: 1e-4 });
  close(F.T2s.tau, 1e-3, 1e-6, 'T2* fitted'); close(F.T2.tau, CK.T2, 1e-9, 'T2 fitted'); close(F.T1.tau, CK.T1, 1e-8, 'T1 fitted');
  // A clock is read only once it has run: to 5 ms, T2* is there and T2, T1 are not.
  const early = clockFits(c, { from: 1e-4, until: 5e-3 });
  assert(early.T2s && !early.T2 && !early.T1, `fitted to 5 ms: ${JSON.stringify(early)}`);
  // One spin: no fan, so the sum is the spin and T2* = T2.
  const one = threeClocks({ ...P, N: 1, spreadHz: 0 }, logTimes(2e-6, 0.05));
  assert(one.sig.every((s, i) => Math.abs(s - one.perp[i]) < 1e-15), 'one spin: the sum is its own part');
  close(clockFits(one, { from: 1e-4 }).T2s.tau, CK.T2, 1e-9, 'one spin: T2* = T2');
  return `fits: T2* = ${(F.T2s.tau * 1e3).toFixed(4)} ms, T2 = ${(F.T2.tau * 1e3).toFixed(4)} ms, T1 = ${(F.T1.tau * 1e3).toFixed(3)} ms; mean |M⊥ᵢ| = ${p0.toFixed(4)} e^{−t/T2} to ${wp.toExponential(0)}; the sum within ${ws.toFixed(4)} of e^{−t/T2*}`;
});

test('T2 ≤ 2T1 keeps a spin inside the sphere: tipped 10° off z it never grows with T2 = 2T1, and grows past 1 with T2 = 3T1', () => {
  // d|M|²/dt = −2M⊥²/T2 + 2M_z(1 − M_z)/T1, which near z is θ²(1/T1 − 2/T2).
  const th = 10 * Math.PI / 180, T1 = 0.1, longest = {};
  for (const T2 of [0.2, 0.3]) {
    const e = new Engine({ B0, N: 1, T1, T2 });
    e.reset([Math.sin(th), 0, Math.cos(th)], 0); e.setSampling(Infinity);
    let mx = 0;
    for (let k = 0; k < 400; k++) { e.advance(1e-3); mx = Math.max(mx, norm(e.sum('rot'))); }
    longest[T2] = mx;
  }
  assert(longest[0.2] <= 1 + 1e-12, `T2 = 2T1: |M| reaches ${longest[0.2]}`);
  assert(longest[0.3] > 1.001, `T2 = 3T1: |M| reaches ${longest[0.3]}`);
  // The slope at the start, against θ²(1/T1 − 2/T2).
  const e = new Engine({ B0, N: 1, T1, T2: 0.3 });
  e.reset([Math.sin(th), 0, Math.cos(th)], 0); e.setSampling(Infinity); e.advance(1e-6);
  const slope = (norm(e.sum('rot')) ** 2 - 1) / 1e-6, exact = -2 * Math.sin(th) ** 2 / 0.3 + 2 * Math.cos(th) * (1 - Math.cos(th)) / T1;
  close(slope, exact, 1e-3 * Math.abs(exact), 'd|M|²/dt at the start');
  return `tipped 10°: the longest |M| is ${longest[0.2].toFixed(6)} with T2 = 2T1, ${longest[0.3].toFixed(4)} with T2 = 3T1 (d|M|²/dt = ${slope.toFixed(4)}/s at first)`;
});

test('the CPMG train beside the clocks: each echo reaches the spins\' own mean length and never passes it, so the echoes fall with T2, not T2*', () => {
  const T2s = T2star(CK.T2, CK.df), tr = clockTrain(T2s, CK.T2, 0.3);
  close(tr.tau, 2.5e-3, 1e-15, 'τ: 2τ = T2/2 (and ≥ 5 T2*)'); assert(tr.n === 12, `${tr.n} echoes, to 6 T2`);
  const s = buildSequence('cpmg', tr.tau, tr.n, T2s);
  const e = startSequence({ B0, B1, N: 4096, spreadHz: CK.df, T1: CK.T1, T2: CK.T2 }, s.pulses, s.span, Infinity);
  const rows = [];
  for (const te of s.echoes) { e.advance(te - e.t); const m = e.sum('rot'); rows.push([te, Math.hypot(m[0], m[1]), e.meanTransverse()]); }
  for (const [te, echo, own] of rows) {
    assert(echo <= own + 1e-15, `at ${te}: the echo ${echo} is longer than the spins' mean ${own}`);
    close(own, Math.exp(-te / CK.T2), 0.002, `the spins' own mean at ${te * 1e3} ms`);
  }
  rows.slice(0, 8).forEach(([te, echo, own]) => assert(echo > 0.99 * own, `echo at ${te * 1e3} ms: ${echo} of ${own}`));
  const fit = fitShape(rows.map((r) => r[0]), rows.map((r) => r[1]), 'decay');
  close(fit.tau, CK.T2, 0.005 * CK.T2, 'T2 from the echoes');
  return `${tr.n} echoes every ${(2 * tr.tau * 1e3).toFixed(1)} ms: each ${rows.slice(0, 8).map((r) => (r[1] / r[2]).toFixed(4)).join(', ')}… of the spins' own mean; fit T2 = ${(fit.tau * 1e3).toFixed(3)} ms`;
});

test('inversion recovery: M_z(τ) = 1 − 2e^{−τ/T1}, the null at T1 ln 2, and the fit finds T1', () => {
  const T1 = 0.03, T2 = 0.02, taus = [2, 5, 10, 15, 20, 25, 30, 40, 50, 70, 90].map((ms) => ms * 1e-3);
  const c = recoveryCurve({ B0, B1, N: 1, T1, T2 }, taus);
  // The reading is the mean of M_y′ over a window w just after the π/2, which the FID's T2 decay
  // lowers by (T2/w)(1 − e^{−w/T2}).
  const k = (T2 / c.window) * (1 - Math.exp(-c.window / T2));
  let worst = 0;
  taus.forEach((tau, i) => { worst = Math.max(worst, Math.abs(c.amp[i] - k * (1 - 2 * Math.exp(-tau / T1)))); });
  assert(worst < 3e-4, `signed amplitude against 1 − 2e^{−τ/T1}: worst ${worst}`);
  close(c.fit.T1, T1, 1e-3 * T1, 'T1 fitted'); close(c.fit.nullAt, T1 * Math.LN2, 1e-4, 'the null');
  return `T1 = ${(c.fit.T1 * 1e3).toFixed(3)} ms from eleven delays (set 30); the null at ${(c.fit.nullAt * 1e3).toFixed(2)} ms = T1 ln 2; readings within ${worst.toExponential(1)} of the closed form`;
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
  const f = new Engine({ B0, N: 4096, spreadHz: 500 });
  f.reset([0, 1, 0], 0); f.setSampling(5e-6); f.advance(8e-3);
  const sf = spectrum(f.record, 0, 8e-3, 0, 2048, 4);
  close(sf.peak.f, 0, sf.df, 'on resonance'); close(sf.fwhm, 500, 15, 'FWHM = Δf');
  close(s.peak.power, (T2 / 12e-3) ** 2, 0.02 * (T2 / 12e-3) ** 2, 'the height of the line: (T2/T_record)²');
  return `one spin, T2 = 1 ms: peak at ${s.peak.f.toFixed(1)} Hz, width at half power ${s.fwhm.toFixed(1)} Hz (1/πT2 = ${(1 / (Math.PI * T2)).toFixed(1)}); 4096 spins spread 500 Hz: width ${sf.fwhm.toFixed(1)} Hz`;
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

test('the switch-off: sudden when A = γBE²τ/Bp ≪ 1 (M left across the Earth\'s field), adiabatic when ≫ 1 (M follows down to ẑ)', () => {
  const Bp = 5.2249e-3 * 1.5, BE = 46.03e-6;
  const A = adiabaticity(Bp, BE, 0.4e-3);
  close(A, 0.0289, 5e-4, 'the board\'s 0.4 ms');
  // The spins follow the field while it turns slower than they precess about it, until the
  // ramp is nearly over, and are left tilted a little towards BE: 8.7° at the board's 0.4 ms (98.9%).
  const sudden = leftAcross(Bp, BE, 0.4e-3);
  assert(sudden.across > 0.985 && sudden.along > 0.1 && sudden.along < 0.2, `0.4 ms: across ${sudden.across}, along ${sudden.along}`);
  const fine = switchOff([1, 0, 0], Bp, BE, 0.4e-3, { perPeriod: 96 });
  close(fine[2], sudden.along, 1e-3, 'converged in the step');
  const instant = leftAcross(Bp, BE, 4e-6);
  assert(instant.across > 0.9995, `A = 3e-4: across ${instant.across}`);
  const tauAd = (30 * Bp) / (GAMMA * BE * BE);
  const adiabatic = leftAcross(Bp, BE, tauAd);
  assert(adiabatic.along > 0.999 && adiabatic.across < 0.05, `A = 30: across ${adiabatic.across}, along ${adiabatic.along}`);
  const mid = leftAcross(Bp, BE, Bp / (GAMMA * BE * BE));
  assert(mid.across > 0.6 && mid.across < 0.75, `A = 1: across ${mid.across}`);
  // The naive γBE τ says nothing: it is 4.9 at the board's 0.4 ms, which is sudden.
  close(GAMMA * BE * 0.4e-3, 4.93, 0.01, 'γ BE τ');
  close(polarized(3, 2.5, Bp, BE), 1 - Math.exp(-1.2), 1e-4, 'polarized in 3 s with T1 = 2.5 s');
  return `A = ${A.toFixed(4)} at 0.4 ms: ${(sudden.across * 100).toFixed(1)}% left across; A = 1 (τ = ${(Bp / (GAMMA * BE * BE) * 1e3).toFixed(1)} ms): ${(mid.across * 100).toFixed(0)}%; A = 30 (τ = ${(tauAd * 1e3).toFixed(0)} ms): ${(adiabatic.along * 100).toFixed(2)}% along ẑ`;
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
  const amp0 = e.record.envelopeMax(t0, t0 + 0.002).max, amp1 = e.record.envelopeMax(t0 + 1, t0 + 1.002).max;
  const T2s = T2star(T2, spread);
  close(amp1 / amp0, Math.exp(-1 / T2s), 0.03, 'the FID fades with T2*');
  const across = leftAcross(Bp, BE, 0.4e-3).across * polarized(3, T1, Bp, BE);
  close(amp0, across * Math.exp(-0.019 / T2s), 0.01, 'its start: what the switch-off left across, 19 ms on');
  const c = polarizeCurve({ T1, T2, N: 1 }, { Bp, BE, ramp: 0.4e-3, tOpen: 0.019 }, [0.2, 0.5, 1, 1.5, 2, 3, 4, 4.7]);
  close(c.fit.T1, T1, 0.01 * T1, 'T1 from the polarizing time');
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
  for (let i = 0; i < 4000; i++) R.push(i * 1e-5, 0, 0, 0, { seed: 11, dt: 1e-5, averages: 1 });
  const one = noiseRms(R, 0, 1, 0.2);
  R.renoise(12, 25);
  const avg = noiseRms(R, 0, 1, 0.2);
  close(one, 0.2, 0.01, 'σ = 0.2 with no averaging'); close(one / avg, 5, 0.3, '25 averages: 5 times smaller');
  // And by averaging for real: 25 noisy repeats of the same signal, added up and divided.
  const sig = (i) => Math.sin(i / 30), reps = 25, n2 = 4000, sum = new Float64Array(n2);
  for (let r = 0; r < reps; r++) for (let i = 0; i < n2; i++) sum[i] += sig(i) + 0.2 * rng.gauss();
  const resid = Array.from(sum, (v, i) => v / reps - sig(i));
  close(rms(resid), avg, 0.004, 'the record\'s averaged noise is what averaging 25 repeats leaves');
  return `unit noise: r.m.s. ${rms(a).toFixed(4)}, ${(100 * within / n).toFixed(1)}% within 1σ; 16 averages: ${rms(b).toFixed(4)}; a record at σ = 0.2: ${one.toFixed(4)}, after 25 averages ${avg.toFixed(4)} (25 repeats averaged by hand: ${rms(resid).toFixed(4)})`;
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

test('the noise of a sample depends on its place on the grid, not on how the run was stepped', () => {
  const a = new Engine({ B0, N: 1 }), b = new Engine({ B0, N: 1 });
  for (const e of [a, b]) { e.noiseSeed = 99; e.setSampling(1e-6); e.reset([0, 1, 0], 0); }
  a.advance(50e-6);
  for (let k = 0; k < 37; k++) b.advance(50e-6 / 37);
  const grid = (e) => e.record.t.map((t, i) => [t, e.record.nx[i]]).filter(([t]) => Math.abs(t / 1e-6 - Math.round(t / 1e-6)) < 1e-9);
  const ga = grid(a), gb = new Map(grid(b).map(([t, n]) => [Math.round(t / 1e-6), n]));
  let same = 0;
  for (const [t, n] of ga) if (gb.get(Math.round(t / 1e-6)) === n) same++;
  assert(same === ga.length && ga.length >= 50, `${same} of ${ga.length} grid samples have the same noise`);
  return `${ga.length} samples on the grid: the same noise whether the clock ran in 1 step or 37`;
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

// ------------------------------------------------------------ the board's tank and receiver
// The reference numbers are the board's design arithmetic (sim/design.json of
// github.com/gallicchio/earth-nmr-pcb), computed there independently of this code.

const DESIGN = {
  fL: 1959.756157384, Cres: 2.4623161259651864e-7, Q: 37.245717738511196, Rp: 12284.306177122584,
  code: 75, Cdip: 2.4729e-7, fdip: 1955.5578369142356, Cmax: 8.4119e-7,
  emf: 1.1988426305747933e-6, vTank: 4.4651754231283e-5, fidOut: 0.8806016966064107,
  enTank: 1.4098754989668371e-8, enTotal: 1.720739526753291e-8, nbw: 82.65051555845032,
  db1960: -0.25152878027065817, db60: -85.23029245395115, fLo: 687.8599123088075, fHi: 4216.965034285822,
};

test('the tank: resonance at 1/(2π√(LC)) with |H| = Q = ωL/R and −90° there, 1 below, 0 and −180° above, f/Q wide at half power', () => {
  const C = bankC(75), fT = resonance(C), Q = quality(fT);
  const h = tankH(fT, C);
  close(h.mag, Q, 1e-9 * Q, '|H| at the resonance');
  close(h.phase, -Math.PI / 2, 1e-12, 'its phase');
  close(tankH(1, C).mag, 1, 1e-5, 'far below');
  assert(tankH(50 * fT, C).mag < 1e-3 && tankH(50 * fT, C).phase < -Math.PI + 0.02, 'far above: nothing, and −180°');
  // The half-power points of |H|², by bisection on either side of the peak.
  const peak = Math.max(...Array.from({ length: 2001 }, (_, k) => tankH(fT * (0.99 + k * 1e-5), C).mag)) ** 2;
  const half = (lo, hi) => { for (let i = 0; i < 80; i++) { const m = (lo + hi) / 2; if ((tankH(m, C).mag ** 2 > peak / 2) === (lo < fT)) hi = m; else lo = m; } return (lo + hi) / 2; };
  const w = half(fT, 2 * fT) - half(fT / 2, fT);
  close(w / tankWidth(), 1, 2 / Q ** 2, 'the width against R/(2πL)');
  close(tankWidth(), fT / Q, 1e-9, 'R/(2πL) = f/Q');
  return `C = ${(C * 1e9).toFixed(2)} nF: f_T = ${fT.toFixed(2)} Hz, |H| = Q = ${Q.toFixed(3)}, −90°; ${w.toFixed(2)} Hz wide at half power (R/2πL = ${tankWidth().toFixed(2)} Hz)`;
});

test('the bank and the handbook\'s procedure: switches 1 2 4 7 for Claremont, the tank at 1955.6 Hz; a 3.3 nF step moves it 13 Hz', () => {
  const t = tuneFor(46.028e-6, 42.577478e6);
  close(t.f, DESIGN.fL, 1e-6, 'the protons\' frequency');
  close(t.C / DESIGN.Cres, 1, 1e-9, 'C = 1/(4π²f²L)');
  assert(t.code === DESIGN.code && t.switches.join(' ') === '1 2 4 7', `the code ${t.code}: switches ${t.switches}`);
  close(t.Cset, DESIGN.Cdip, 1e-15, 'their capacitance, the clamp\'s 0.39 nF with it');
  close(t.fT, DESIGN.fdip, 1e-6, 'the tank\'s frequency then');
  close(bankC(0), 0.39e-9, 1e-18, 'all off: the clamp alone');
  close(bankC(255), DESIGN.Cmax, 1e-15, 'all on');
  close(codeFor(capacitanceFor(1955.5578)), 75, 0, 'and back');
  // Each code is about 3.3 nF more than the last (binary weights of 3.3 nF): 13 Hz near 2 kHz.
  const step = resonance(bankC(76)) - resonance(bankC(75)), dC = bankC(76) - bankC(75);
  assert(dC > 3.1e-9 && dC < 3.4e-9 && step < -12 && step > -14, `code 75 → 76: ${(dC * 1e9).toFixed(2)} nF, ${step.toFixed(2)} Hz`);
  // Near Claremont (±10% of the field) the nearest code always leaves the protons on the tank's top.
  let worst = 1;
  for (let B = 41.4e-6; B <= 50.6e-6; B += 0.01e-6) { const u = tuneFor(B); worst = Math.min(worst, tankH(u.f, u.Cset).mag / quality(u.f)); }
  assert(worst > 0.93, `worst |H|/Q from 41.4 to 50.6 μT: ${worst}`);
  // The largest capacitance tunes the board's coil down to 1061 Hz (24.9 μT) only.
  close(resonance(bankC(255)), 1060.7, 0.5, 'the lowest frequency');
  return `${t.f.toFixed(2)} Hz needs ${(t.C * 1e9).toFixed(2)} nF: switches ${t.switches.join(' ')} = ${(t.Cset * 1e9).toFixed(2)} nF → ${t.fT.toFixed(2)} Hz; one step: ${step.toFixed(1)} Hz; within ±10% of the field |H| ≥ ${worst.toFixed(3)} Q`;
});

test('the receiver: ×20 301 with −0.25 dB at 1960 Hz, −85 dB at 60 Hz, half power at 688 Hz and 4.2 kHz; the FID 44.7 μV on the tank, 0.881 V at OUT', () => {
  const db = (f) => 20 * Math.log10(filterH(f).mag);
  close(db(DESIGN.fL), DESIGN.db1960, 1e-6, 'at the protons\' frequency');
  close(db(60), DESIGN.db60, 1e-6, 'at the mains\' 60 Hz');
  // The −3 dB points from the peak, by bisection (the design read them off a grid 0.58% apart).
  let peak = 0;
  for (let f = 1000; f < 3000; f += 1) peak = Math.max(peak, filterH(f).mag);
  const corner = (lo, hi, rising) => { for (let i = 0; i < 80; i++) { const m = (lo + hi) / 2; if ((filterH(m).mag > peak / Math.SQRT2) === rising) hi = m; else lo = m; } return (lo + hi) / 2; };
  const fLo = corner(300, 1500, true), fHi = corner(2500, 9000, false);
  assert(fLo <= DESIGN.fLo && fLo > DESIGN.fLo / 1.0058 && fHi >= DESIGN.fHi && fHi < DESIGN.fHi * 1.0058, `corners ${fLo}, ${fHi}`);
  // Tuned exactly, the tank gives Q times the EMF; ×20 301 and the filters: OUT.
  const h = tankH(DESIGN.fL, DESIGN.Cres);
  close(h.mag, DESIGN.Q, 1e-6 * DESIGN.Q, 'Q');
  close(DESIGN.emf * h.mag, DESIGN.vTank, 1e-12, 'on the tank');
  close(DESIGN.emf * h.mag * RECEIVER.gain.high * filterH(DESIGN.fL).mag, DESIGN.fidOut, 1e-6, 'at OUT');
  return `${db(DESIGN.fL).toFixed(4)} dB at ${DESIGN.fL.toFixed(1)} Hz, ${db(60).toFixed(2)} dB at 60 Hz; half power at ${fLo.toFixed(1)} and ${fHi.toFixed(0)} Hz; FID ${(DESIGN.emf * h.mag * 1e6).toFixed(2)} μV on the tank, ${(DESIGN.emf * h.mag * RECEIVER.gain.high * filterH(DESIGN.fL).mag).toFixed(4)} V at OUT`;
});

test('the noise: the coil\'s is √(kT/C) whatever its resistance (equipartition), √(4kT Q²R) per √Hz at the top; 17.2 nV/√Hz in all there, 12.6 mV at OUT', () => {
  const C = bankC(75);
  const n = receiverNoise(C, { filters: false });
  close(n.coil / kTC(C), 1, 1e-3, '∫ 4kTR |H|² df = kT/C');
  const lossy = { ...TANK, R: 3 * TANK.R };
  close(receiverNoise(C, { tank: lossy, filters: false }).coil / kTC(C), 1, 1e-3, 'three times the resistance: the same');
  // At the design's exact tuning: the tank's part √(4kT Rp), Rp = Q²R, and the total.
  const d = noiseDensity(DESIGN.fL, DESIGN.Cres);
  close(d.coil / DESIGN.enTank, 1, 1e-5, 'the tank\'s thermal noise at the top');
  close(d.total / DESIGN.enTotal, 1, 1e-5, 'with the preamplifier\'s and the bias resistors\'');
  close(DESIGN.Q ** 2 * TANK.R, DESIGN.Rp, 1e-6, 'Rp');
  // The noise bandwidth of |H|²/Q²: (π/2) f/Q.
  const nbw = (receiverNoise(DESIGN.Cres, { filters: false }).coil ** 2) / (4 * K_B * TANK.T * TANK.R * DESIGN.Q ** 2);
  close(nbw / DESIGN.nbw, 1, 2e-3, 'the noise bandwidth');
  const out = receiverNoise(C);
  const vout = out.total * RECEIVER.gain.high;
  assert(vout > 0.012 && vout < 0.013, `at OUT on HIGH: ${vout} V r.m.s.`);
  assert(out.amp > 4 * out.coil, 'over the whole band, the preamplifier\'s noise is most of it');
  return `√(kT/C) = ${(kTC(C) * 1e9).toFixed(1)} nV (integrated ${(n.coil * 1e9).toFixed(1)}, and ${(receiverNoise(C, { tank: lossy, filters: false }).coil * 1e9).toFixed(1)} with 3R); ${(d.total * 1e9).toFixed(2)} nV/√Hz at the top; band ${nbw.toFixed(2)} Hz; OUT ${(vout * 1e3).toFixed(2)} mV r.m.s. (the coil's ${(out.coil * RECEIVER.gain.high * 1e3).toFixed(2)}, the preamplifier's ${(out.amp * RECEIVER.gain.high * 1e3).toFixed(2)})`;
});

test('OUT at an audio rate: the FID through the tank\'s gain and phase, and noise of the r.m.s. integrated', () => {
  const C = bankC(75), fL = 1959.734, fs = 48000, K = tankH(fL, C).mag * filterH(fL).mag * RECEIVER.gain.high;
  const phi = tankH(fL, C).phase + filterH(fL).phase, w = 2 * Math.PI * fL;
  const sig = synthOut({ fs, t0: 3.2, n: 500, fL, C, emf: (t, m) => { m[0] = 1e-6; m[1] = 0; }, noise: false });
  let err = 0;
  for (let j = 0; j < 500; j++) err = Math.max(err, Math.abs(sig[j] - K * 1e-6 * Math.sin(w * (3.2 + j / fs) + phi)));
  close(err, 0, 1e-6, 'the FID at OUT');
  const rmsOf = (a) => Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length);
  const rows = [];
  for (const [code, avg] of [[75, 1], [0, 1], [75, 16]]) {
    const c = bankC(code), want = (receiverNoise(c).total * RECEIVER.gain.high) / Math.sqrt(avg);
    const got = rmsOf(synthOut({ fs, t0: 1, n: fs, fL, C: c, seed: 9, averages: avg }));
    close(got / want, 1, 0.03, `code ${code}, ${avg} averaged`);
    rows.push(`${(got * 1e3).toFixed(2)} mV (${(want * 1e3).toFixed(2)})`);
  }
  // The same stretch of OUT whichever stretch it was computed in.
  const a = synthOut({ fs, t0: 1, n: 2000, fL, C, seed: 3 }), b = synthOut({ fs, t0: 1 + 1000 / fs, n: 1000, fL, C, seed: 3 });
  let d = 0;
  for (let j = 0; j < 1000; j++) d = Math.max(d, Math.abs(a[1000 + j] - b[j]));
  assert(d < 1e-3 * rmsOf(a), `two computations of the same stretch differ by ${d}`);
  return `the FID ×${K.toFixed(0)} at ${(phi * 180 / Math.PI).toFixed(1)}°; noise at OUT, r.m.s. of 1 s: tuned ${rows[0]}, no tank ${rows[1]}, 16 averaged ${rows[2]}`;
});

test('the coil\'s angle α to the Earth\'s field: sin α of M precesses, the coil sees sin α of that, so the FID goes as sin² α', () => {
  const Bp = 5.2249e-3 * 1.5, BE = 46.03e-6, rows = [];
  for (const deg of [90, 58.89, 31.11, 10]) {
    const a = (deg * Math.PI) / 180;
    // A sudden switch-off (0.1 μs) leaves M where it was: sin α of it across the field.  (While
    // Bp is still many times BE the spins follow its slight turning a little: by 1° at 10 μs,
    // 8.7° at the board's 0.4 ms, which costs cos 8.7° across a coil square to the field, but
    // more, to first order, across a coil at a slant.)
    close(leftAcross(Bp, BE, 0.1e-6, 1, a).across, Math.sin(a), 2e-3, `${deg}°: left across`);
    // The board's cycle: polarize along the coil, switch off in 0.1 μs, listen.
    const e = new Engine({ N: 1, T1: 1, T2: 1 });
    e.setSampling(1e-3);
    e.startEarth({ Bp, BE, tp: 60, ramp: 0.1e-6, tl: 0.1, tOpen: 0.019, angle: a });
    e.advance(e.tEnd - e.t);
    const t0 = 60 + 0.1e-6 + 0.02, m = e.record.envelopeMax(t0, t0 + 0.01).max / Math.exp(-0.02);
    // The EMF in a coil along n̂ is −d(M·n̂)/dt: the precessing part of M, times sin α.
    const fid = m * Math.sin(a), board = leftAcross(Bp, BE, 0.4e-3, 1, a).across * Math.sin(a);
    close(fid, Math.sin(a) ** 2, 3e-3, `${deg}°: the FID`);
    rows.push(`${deg}°: ${fid.toFixed(4)} (sin² ${(Math.sin(a) ** 2).toFixed(4)}; ${board.toFixed(4)} after the board's 0.4 ms)`);
  }
  close(adiabaticity(Bp, BE, 0.4e-3, Math.PI / 6), 2 * adiabaticity(Bp, BE, 0.4e-3), 1e-12, 'the field turns 1/sin α more slowly at the end');
  close(polarized(Infinity, 1, Bp, BE, 0), 1, 1e-12, 'a coil along the field polarizes along it');
  close(leftAcross(Bp, BE, 10e-6, 1, 0).across, 0, 1e-9, 'and leaves nothing across it');
  return rows.join('; ');
});
