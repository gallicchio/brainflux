import { test, assert, close } from './harness.js';
import { Simulation, M, sinc, binFrequency } from '../radiointerferometer/sim.js';
import { makeTape, sampleTape, receiverStream, realVoltage, voltageAt, LEN, TAPE_CYCLES } from '../radiointerferometer/display.js';
import { fft, ifft, fft2 } from '../lib/fft.js';
import { idealGrid, idealAt, idealWindow, samplePoints, pointSources, galaxy, normalise, N, NS } from '../radiointerferometer/sky.js';
import {
  stationXYZ, tracks, gridSamples, dirtyBeam, skyTransform, dirtyImage, cleanStart, cleanSteps, fitBeam, restore, cleanBeamKernel, layout,
} from '../radiointerferometer/synthesis.js';
import { memStart, memSteps, memRestored, windowIndices, rmsError, beamKernel, convolve } from '../radiointerferometer/imaging.js';

const DEG = Math.PI / 180;
// A tiny deterministic random generator, so the tests are repeatable.
function rng(seed) { return () => ((seed = (seed * 16807) % 2147483647) / 2147483647); }
const far = (sim) => (k) => sim.direction(k);
function average(sim, chunks) {
  let re = 0, im = 0;
  for (let i = 0; i < chunks; i++) { const [a, b] = sim.step(); re += a; im += b; }
  return [re / chunks, im / chunks];
}

// ------------------------------------------------------------------ the simulated pair

test('the pair’s average converges to V = Σ I e^{−2πi(ul+vm)} within the radiometer scatter σ = √(P_A P_B / 2N) per chunk', () => {
  const notes = [];
  for (const [u, v, seed] of [[3, 0, 7], [0, 5, 8], [7.3, -2.1, 9], [-4, 4, 10]]) {
    const sim = new Simulation();
    sim.random = rng(seed); sim.band = 0.02; sim.noise = 0.5;
    sim.sources = pointSources('pentagon', { scale: 0.3 });
    sim.receivers = [{ u: -u / 2, v: -v / 2 }, { u: u / 2, v: v / 2 }];
    const n = 300, [mr, mi] = average(sim, n), [ir, ii] = sim.ideal(u, v), [er, ei] = sim.expected();
    const sig = sim.chunkScatter() / Math.sqrt(n), err = Math.hypot(mr - er, mi - ei);
    // The band's coherence envelope sinc(β Δτ) is within 1% of 1 at this band and these baselines.
    close(Math.hypot(er - ir, ei - ii), 0, 0.01 * Math.hypot(ir, ii) + 0.02, `(${u},${v}) expected vs ideal`);
    assert(err < 4 * sig, `(${u},${v}): error ${err.toFixed(4)} > 4 σ (${sig.toFixed(4)})`);
    notes.push(`${(err / sig).toFixed(1)}σ`);
  }
  return `errors ${notes.join(', ')} of σ(mean)`;
});

test('the scatter of one chunk’s correlation is the radiometer value √(P_A P_B / 2N), N = Δν T independent samples', () => {
  for (const band of [0.02, 0.2, 1]) {
    const sim = new Simulation();
    sim.random = rng(21); sim.band = band; sim.noise = 1;
    sim.sources = [{ l: 0.1, m: 0, I: 1 }];
    sim.receivers = [{ u: -1, v: 0 }, { u: 1, v: 0 }];
    const n = 400, vals = [];
    for (let i = 0; i < n; i++) vals.push(sim.step().slice());
    const mr = vals.reduce((a, c) => a + c[0], 0) / n, mi = vals.reduce((a, c) => a + c[1], 0) / n;
    const s2 = vals.reduce((a, c) => a + (c[0] - mr) ** 2 + (c[1] - mi) ** 2, 0) / (2 * n);
    const pred = sim.chunkScatter();
    close(Math.sqrt(s2) / pred, 1, 0.12, `band ${band}: measured/predicted scatter`);
  }
});

test('a wide band and a long baseline: the correlation dies as sinc(β Δτ); the electronic delay towards the source restores it', () => {
  const sim = new Simulation();
  sim.random = rng(3); sim.band = 0.4; sim.noise = 0;
  sim.sources = [{ l: 0.5, m: 0, I: 1 }];
  const notes = [];
  for (const u of [1, 2, 4, 10]) {
    sim.receivers = [{ u: -u / 2, v: 0 }, { u: u / 2, v: 0 }];
    sim.tracking = false; sim.pointing = { l: 0, m: 0 }; sim.reset();
    const [r, i] = average(sim, 200), mag = Math.hypot(r, i), pred = Math.abs(sinc(0.4 * u * 0.5));
    close(mag, pred, 0.03, `u = ${u}: |c| against sinc(β u l)`);
    sim.tracking = true; sim.pointing = { l: 0.5, m: 0 }; sim.reset();
    const [tr, ti] = average(sim, 200);
    close(Math.hypot(tr, ti), 1, 0.03, `u = ${u}, tracking: |c|`);
    close(Math.atan2(ti, tr), 0, 0.05, `u = ${u}, tracking: the phase is stopped`);
    notes.push(`${mag.toFixed(2)}→${Math.hypot(tr, ti).toFixed(2)}`);
  }
  return `|c| without → with tracking: ${notes.join(', ')}`;
});

test('the autocorrelation of band-limited noise: R(0) = the power, first zero at the coherence time 1/Δν, and the spectrum flat over the band', () => {
  for (const band of [0.02, 0.1, 0.5]) {
    const sim = new Simulation();
    // A true mean over 1000 chunks (α = 1/1000 averages them all equally).
    sim.random = rng(11); sim.band = band; sim.noise = 0; sim.alpha = 1 / 1000;
    sim.sources = [{ l: 0, m: 0, I: 1 }];
    for (let i = 0; i < 1000; i++) sim.step();
    const tmax = 3 / band, pts = 1201;
    sim.lags(tmax, pts);
    const R = sim.lagAA[0], h = (pts - 1) / 2, dt = (2 * tmax) / (pts - 1);
    close(R[h], 1, 0.03, `band ${band}: R(0)`);
    let zero = -1;
    for (let i = h + 1; i < pts; i++) if (R[i - 1] > 0 && R[i] <= 0) { zero = (i - 1 - h + R[i - 1] / (R[i - 1] - R[i])) * dt; break; }
    // The band made is the odd number of bins nearest the width asked for: within a bin of it.
    const bw = sim.bandwidth();
    assert(Math.abs(bw - band) <= 1 / 512 + 1e-12, `band ${band}: made ${bw}`);
    close(zero * bw, 1, 0.01, `band ${band}: first zero × Δν`);
    // The averaged spectrum: flat inside the band (each bin ~ power / bins), zero outside, and
    // symmetric about the carrier.
    const nb = sim.bandBins(), inBand = new Set(Array.from(sim.bins.subarray(0, nb)));
    let inside = 0, outside = 0, worst = 0;
    for (let b = 0; b < M; b++) {
      if (inBand.has(b)) { inside += sim.specAA[b]; worst = Math.max(worst, Math.abs(sim.specAA[b] * nb - 1)); } else outside += sim.specAA[b];
      assert(inBand.has(b) === (Math.abs(binFrequency(b)) <= (bw - 1 / 512) / 2 + 1e-9), `bin ${b} (f = ${binFrequency(b)}) in the band`);
    }
    // R(τ) is real for a symmetric band (its imaginary part is the averaging noise only).
    let imag = 0;
    for (let i = 0; i < pts; i++) imag = Math.max(imag, Math.abs(sim.lagAA[1][i]));
    assert(imag < 0.15, `band ${band}: Im R up to ${imag.toFixed(3)}`);
    // The expected coherence is the band's Dirichlet kernel, ≈ sinc(Δν τ).
    close(sim.coherence(0.5 / bw), sinc(0.5), 0.01, `band ${band}: coherence at half the coherence time`);
    close(inside, 1, 0.06, `band ${band}: the band holds the power`);
    assert(outside === 0, 'nothing outside the band');
    assert(worst < 0.6, `band ${band}: the band is flat to the averaging noise (worst ${worst.toFixed(2)})`);
  }
});

test('two independent sources: each source’s own term adds up to V, the cross terms average away', () => {
  const sim = new Simulation();
  sim.random = rng(5); sim.band = 0.1; sim.noise = 0.3;
  sim.sources = [{ l: 0.3, m: 0, I: 1 }, { l: -0.2, m: 0.1, I: 0.5 }];
  sim.receivers = [{ u: -4, v: 0 }, { u: 4, v: 0 }];
  let sr = 0, si = 0, cr = 0, ci = 0;
  const n = 400;
  for (let i = 0; i < n; i++) { sim.step(); sr += sim.chunkSelf[0]; si += sim.chunkSelf[1]; cr += sim.chunkCross[0]; ci += sim.chunkCross[1]; }
  // The self terms add up to V with each source's coherence envelope sinc(β Δτ) (0.906 and
  // 0.958 here: the band is wide enough to smear the edges of this field).
  const [er, ei] = sim.expected(), [ir, ii] = sim.ideal(8, 0), sig = sim.chunkScatter() / Math.sqrt(n);
  assert(Math.hypot(sr / n - er, si / n - ei) < 4 * sig, `self terms ${(sr / n).toFixed(3)}+${(si / n).toFixed(3)}i against ${er.toFixed(3)}+${ei.toFixed(3)}i (σ ${sig.toFixed(3)})`);
  close(Math.hypot(er, ei) / Math.hypot(ir, ii), (1 * sinc(0.1 * 2.4) + 0.5 * sinc(0.1 * 1.6)) / 1.5, 0.05, 'the envelope’s share');
  assert(Math.hypot(cr / n, ci / n) < 4 * sig, `cross terms ${Math.hypot(cr / n, ci / n).toFixed(3)} not gone (σ ${sig.toFixed(3)})`);
  return `cross terms ${Math.hypot(cr / n, ci / n).toFixed(3)} after ${n} chunks (σ ${sig.toFixed(3)})`;
});

test('correlating intensities (Hanbury Brown–Twiss) gives |V|²: the phase is lost', () => {
  const sim = new Simulation();
  sim.random = rng(9); sim.band = 0.2; sim.noise = 0.2; sim.hbt = true;
  sim.sources = [{ l: 0.1, m: 0, I: 1 }, { l: -0.1, m: 0, I: 1 }];
  const notes = [];
  for (const u of [1, 2.5, 5]) {
    sim.receivers = [{ u: -u / 2, v: 0 }, { u: u / 2, v: 0 }]; sim.reset();
    let s = 0;
    const n = 500;
    for (let i = 0; i < n; i++) { sim.step(); s += sim.chunkHbt; }
    const [ir, ii] = sim.ideal(u, 0);
    close(s / n, ir * ir + ii * ii, 0.25, `u = ${u}: ⟨ΔI_A ΔI_B⟩ against |V|²`);
    notes.push(`${(s / n).toFixed(2)} vs ${(ir * ir + ii * ii).toFixed(2)}`);
  }
  return notes.join(', ');
});

test('coherent sources: the correlation depends on where the pair sits, not only on its separation', () => {
  const sim = new Simulation();
  sim.random = rng(13); sim.band = 0.05; sim.noise = 0; sim.coherent = true; sim.coherentPhase = 0.7;
  sim.sources = [{ l: 0.3, m: 0, I: 1 }, { l: -0.3, m: 0, I: 1 }];
  const seen = [];
  for (const c of [0, 1, 2]) {
    sim.receivers = [{ u: c - 2, v: 0 }, { u: c + 2, v: 0 }]; sim.reset();
    const [r, i] = average(sim, 300), [er, ei] = sim.expected();
    close(Math.hypot(r - er, i - ei), 0, 0.08, `centre ${c}: measured against the double sum`);
    seen.push(r);
  }
  assert(Math.abs(seen[0] - seen[1]) > 1 && Math.abs(seen[1] - seen[2]) > 1, `the same baseline gives ${seen.map((v) => v.toFixed(2)).join(', ')} at three places`);
  sim.coherent = false; sim.reset();
  const [r0] = average(sim, 300); sim.receivers = [{ u: 0, v: 0 }, { u: 4, v: 0 }]; sim.reset();
  const [r2] = average(sim, 300);
  close(r0, r2, 0.1, 'incoherent: the same at both places');
  return `coherent: ${seen.map((v) => v.toFixed(2)).join(', ')}; incoherent: ${r0.toFixed(2)}, ${r2.toFixed(2)}`;
});

test('the near field: exact distances, and the pair’s centre matters a little', () => {
  const sim = new Simulation();
  sim.random = rng(17); sim.band = 0.02; sim.noise = 0; sim.nearField = true; sim.lambda = 0.3276;
  sim.sources = pointSources('pentagon', { scale: 3, z: 5 });
  const vals = [];
  for (const c of [0, 1.5]) {
    sim.receivers = [{ u: (c - 1) / sim.lambda, v: 0 }, { u: (c + 1) / sim.lambda, v: 0 }]; sim.reset();
    const [r, i] = average(sim, 300), [er, ei] = sim.expected();
    close(Math.hypot(r - er, i - ei), 0, 0.1, `centre ${c}: measured against the exact-distance sum`);
    vals.push([r, i]);
  }
  assert(Math.hypot(vals[0][0] - vals[1][0], vals[0][1] - vals[1][1]) > 0.5, 'the correlation changed when the pair moved');
  const [l, m] = sim.direction(0);
  close(Math.hypot(l, m), 3 / Math.hypot(3, 5), 1e-12, 'a source 3 m out at z = 5 m is at sin θ = 3/√34');
});

test('one antenna alone sees no fringe from incoherent sources; coherent sources make Young’s fringes in its power', () => {
  const sim = new Simulation();
  sim.random = rng(23); sim.band = 0.05; sim.noise = 0.2;
  sim.sources = [{ l: Math.sin(10 * DEG), m: 0, I: 1 }, { l: Math.sin(-20 * DEG), m: 0, I: 0.5 }];
  const xs = Array.from({ length: 41 }, (_, i) => -6 + 0.3 * i), spread = (f) => Math.max(...xs.map(f)) - Math.min(...xs.map(f));
  const inc = spread((x) => sim.powerAt({ u: x, v: 0 }));
  close(inc, 0, 1e-12, 'incoherent: the power is the same everywhere');
  close(sim.powerAt({ u: 0, v: 0 }), 1.7, 1e-12, 'incoherent: the powers add, 1 + 0.5 + the noise 0.2');
  sim.coherent = true; sim.coherentPhase = 0;
  const coh = spread((x) => sim.powerAt({ u: x, v: 0 }));
  // Two coherent waves of amplitudes 1 and √0.5 make fringes between (1 − √0.5)² and (1 + √0.5)².
  close(coh, 4 * Math.sqrt(0.5) * sim.coherence(0), 0.05, 'coherent: the power at one antenna swings by 4√(I₁I₂)');
  // The simulation's measured power at A agrees with the expected one, at a bright and a dark place.
  const notes = [];
  // (A mean over 400 chunks of 25 independent samples: good to about 3.1/√(400·25) = 0.03.)
  sim.alpha = 1 / 400;
  for (const x of [0, 1 / (2 * (Math.sin(10 * DEG) - Math.sin(-20 * DEG)))]) {
    sim.receivers = [{ u: x, v: 0 }, { u: x + 3, v: 0 }]; sim.reset();
    for (let i = 0; i < 400; i++) sim.step();
    close(sim.powerA, sim.powerAt(sim.receivers[0]), 0.12, `coherent: the power at x = ${x.toFixed(2)} λ`);
    notes.push(sim.powerA.toFixed(2));
  }
  return `coherent powers at a bright and a dark place: ${notes.join(', ')}; incoherent: 1.70 everywhere`;
});

test('the expected correlation at any pair of positions: the measured one agrees, also with gains that route one source to each antenna', () => {
  const sim = new Simulation();
  sim.random = rng(29); sim.band = 0.05; sim.noise = 0.3;
  sim.sources = [{ l: 0.17, m: 0, I: 1 }, { l: -0.34, m: 0, I: 0.5 }];
  const rA = { u: -1.2, v: 0 }, rB = { u: 2.9, v: 0 };
  sim.receivers = [rA, rB];
  const [r, i] = average(sim, 400), [er, ei] = sim.expectedAt(rA, rB), sig = sim.chunkScatter() / Math.sqrt(400);
  assert(Math.hypot(r - er, i - ei) < 4 * sig, `measured ${r.toFixed(3)}+${i.toFixed(3)}i against ${er.toFixed(3)}+${ei.toFixed(3)}i`);
  // A hears only source 1 and B only source 2: two independent noises, no correlation at any lag.
  sim.gains = [[1, 0], [0, 1]]; sim.receivers = [{ u: 0, v: 0 }, { u: 0, v: 0 }]; sim.noise = 0; sim.alpha = 0.01; sim.reset();
  for (let k = 0; k < 400; k++) sim.step();
  sim.lags(60, 241);
  let cross = 0, auto = 0;
  for (let p = 0; p < 241; p++) { cross = Math.max(cross, Math.hypot(sim.lagAB[0][p], sim.lagAB[1][p])); auto = Math.max(auto, sim.lagAA[0][p]); }
  close(Math.hypot(...sim.expected()), 0, 1e-12, 'nothing expected');
  assert(cross < 0.1 && auto > 0.9, `independent noises: cross-correlation up to ${cross.toFixed(3)} at any lag, autocorrelation ${auto.toFixed(3)}`);
  return `cross-correlation of two independent noises at most ${cross.toFixed(3)} (each has power 1)`;
});

// ------------------------------------------------------------------ the slowed-down streams

test('display tapes: the power and band asked for, seamless looping, and the same noise a delay later', () => {
  const random = rng(37);
  let power = 0;
  for (let k = 0; k < 10; k++) {
    const t = makeTape(0.1, 2, random);
    for (let i = 0; i < LEN; i++) power += (t.re[i] ** 2 + t.im[i] ** 2) / (10 * LEN);
  }
  close(power, 2, 0.1, 'mean power of ten tapes');
  const tape = makeTape(0.2, 1, random), a = [0, 0], b = [0, 0];
  // Periodic, and the interpolation passes through the samples.
  for (const t of [0.3, 17.81, 511.2]) { sampleTape(tape, t, a); sampleTape(tape, t + TAPE_CYCLES, b); close(Math.hypot(a[0] - b[0], a[1] - b[1]), 0, 1e-12, `loop at ${t}`); }
  sampleTape(tape, 25, a);
  close(Math.hypot(a[0] - tape.re[100], a[1] - tape.im[100]), 0, 1e-12, 'on a sample');
  // Between samples, the interpolated envelope agrees with the exact band-limited one (the tape
  // upsampled 4 times by zero-padding its transform): closely for a narrow band, and to a few per
  // cent of its size even for white noise, whose envelope swings once a cycle.
  const notes = [];
  for (const [band, tol] of [[0.2, 1e-3], [2, 0.08]]) {
    const tp = makeTape(band, 1, random), up = 4, re = new Float64Array(LEN * up), im = new Float64Array(LEN * up);
    const fr = Float64Array.from(tp.re), fi = Float64Array.from(tp.im);
    fft(fr, fi);
    for (let q = 0; q < LEN; q++) { const j = q < LEN / 2 ? q : q + LEN * (up - 1); re[j] = fr[q] * up; im[j] = fi[q] * up; }
    ifft(re, im);
    let err = 0;
    for (let i = 0; i < LEN * up; i += 7) { sampleTape(tp, i / (4 * up), a); err += (a[0] - re[i]) ** 2 + (a[1] - im[i]) ** 2; }
    const rms = Math.sqrt(err / Math.ceil((LEN * up) / 7));
    assert(rms < tol, `band ${band}: interpolation error ${rms.toExponential(2)} (rms, of power 1)`);
    notes.push(`${rms.toExponential(1)} at band ${band}`);
  }
  // B hears the source d cycles after A: its real voltage is A's, d cycles later.
  const d = 2.37, P = 400, envA = [new Float64Array(P), new Float64Array(P)], envB = [new Float64Array(P), new Float64Array(P)];
  receiverStream([{ tape, delay: 0.4, amp: 1 }], null, 0, 10, 60, P, envA);
  receiverStream([{ tape, delay: 0.4 + d, amp: 1 }], null, 0, 10 + d, 60 + d, P, envB);
  const xA = realVoltage(envA, 10, 60, P, new Float64Array(P)), xB = realVoltage(envB, 10 + d, 60 + d, P, new Float64Array(P));
  let worst = 0;
  for (let p = 0; p < P; p++) worst = Math.max(worst, Math.abs(xA[p] - xB[p]));
  close(worst, 0, 1e-9, 'x_B(t + d) = x_A(t)');
  close(voltageAt(tape, 33.3 - 0.4), realVoltage(receiverStream([{ tape, delay: 0.4, amp: 1 }], null, 0, 33.3, 33.3, 1, [new Float64Array(1), new Float64Array(1)]), 33.3, 33.3, 1, new Float64Array(1))[0], 1e-12, 'the field and the receiver agree');
  return `interpolation error ${notes.join(', ')}`;
});

test('the real voltages: ⟨x_A x_B⟩ = Re V, and with B a quarter cycle later, Im V (the handout’s correlation and its quadrature)', () => {
  const random = rng(41), l = Math.sin(10 * DEG), I = 1.3;
  let sr = 0, si = 0;
  const P = 4096, tapes = 12, env = [new Float64Array(P), new Float64Array(P)], envB = [new Float64Array(P), new Float64Array(P)], envQ = [new Float64Array(P), new Float64Array(P)];
  for (let k = 0; k < tapes; k++) {
    const tape = makeTape(0.05, I, random), dA = -(-0.8 * l), dB = -(1.7 * l);
    receiverStream([{ tape, delay: dA, amp: 1 }], null, 0, 0, TAPE_CYCLES, P, env);
    receiverStream([{ tape, delay: dB, amp: 1 }], null, 0, 0, TAPE_CYCLES, P, envB);
    receiverStream([{ tape, delay: dB, amp: 1 }], null, 0, 0.25, TAPE_CYCLES + 0.25, P, envQ);
    const xA = realVoltage(env, 0, TAPE_CYCLES, P, new Float64Array(P)), xB = realVoltage(envB, 0, TAPE_CYCLES, P, new Float64Array(P)), xQ = realVoltage(envQ, 0.25, TAPE_CYCLES + 0.25, P, new Float64Array(P));
    for (let p = 0; p < P; p++) { sr += (xA[p] * xB[p]) / (P * tapes); si += (xA[p] * xQ[p]) / (P * tapes); }
  }
  const u = 1.7 - -0.8, ph = -2 * Math.PI * u * l;
  // One tape of 1024 cycles at 5% holds about 51 independent stretches: the average of 12 is
  // good to about I/√(2·600) = 0.04.
  close(sr, I * Math.cos(ph), 0.12, '⟨x_A x_B⟩ against Re V');
  close(si, I * Math.sin(ph), 0.12, '⟨x_A x_B(t + T/4)⟩ against Im V');
  return `⟨x_A x_B⟩ = ${sr.toFixed(3)} (Re V ${(I * Math.cos(ph)).toFixed(3)}), quadrature ${si.toFixed(3)} (Im V ${(I * Math.sin(ph)).toFixed(3)})`;
});

// ------------------------------------------------------------------ the sky

test('the FFT-based V of a picture equals the direct sum, at grid cells and at points between them', () => {
  const sky = new Float64Array(NS * NS);
  const cells = [[64, 64, 1], [70, 60, 0.5], [50, 80, 0.8], [90, 30, 0.3]];
  for (const [i, j, I] of cells) sky[j * NS + i] = I;
  const model = { kind: 'picture', sky: normalise(sky) }, pix = 1 / NS, g = idealGrid(model, pix);
  let worst = 0;
  for (const [p, q] of [[128, 128], [140, 128], [128, 100], [97, 161], [200, 50]]) {
    const u = (p - N / 2) * g.du, v = (N / 2 - q) * g.du, [re, im] = idealAt(model, pix, null, u, v);
    worst = Math.max(worst, Math.hypot(g.re[q * N + p] - re, g.im[q * N + p] - im));
  }
  assert(worst < 1e-9, `grid vs direct sum: ${worst.toExponential(2)}`);
  close(g.re[(N / 2) * N + N / 2], 1, 1e-12, 'V(0,0) is the total brightness');
  // Points: the window at display resolution agrees with the closed form.
  const pm = { kind: 'points', sources: [{ l: 0.1, m: -0.2, I: 1 }, { l: -0.3, m: 0.05, I: 0.4 }] }, dirs = (k) => [pm.sources[k].l, pm.sources[k].m];
  const w = 16, h = 12, re = new Float64Array(w * h), im = new Float64Array(w * h), umax = 7;
  idealWindow(pm, pix, dirs, null, umax, w, h, re, im);
  for (const [x, y] of [[0, 0], [5, 7], [15, 11]]) {
    const u = ((x + 0.5 - w / 2) / w) * 2 * umax, v = ((h / 2 - y - 0.5) / h) * 2 * umax, [er, ei] = idealAt(pm, pix, dirs, u, v);
    close(Math.hypot(re[y * w + x] - er, im[y * w + x] - ei), 0, 1e-12, `window pixel (${x},${y})`);
  }
  // A picture's window (the separable direct transform) agrees with the direct sum too, between
  // the grid's cells as well.
  idealWindow(model, pix, null, null, 30.7, w, h, re, im);
  for (const [x, y] of [[0, 0], [3, 9], [15, 11]]) {
    const u = ((x + 0.5 - w / 2) / w) * 2 * 30.7, v = ((h / 2 - y - 0.5) / h) * 2 * 30.7, [er, ei] = idealAt(model, pix, null, u, v);
    close(Math.hypot(re[y * w + x] - er, im[y * w + x] - ei), 0, 1e-12, `picture window pixel (${x},${y})`);
  }
  return `largest difference ${worst.toExponential(1)}`;
});

test('a few hundred points drawn from a picture’s brightness have the picture’s V, to the sampling noise 1/√count', () => {
  const model = { kind: 'picture', sky: normalise(galaxy(NS)) }, pix = 1 / NS, random = rng(31);
  const pts = samplePoints(model.sky, pix, 300, random), pm = { kind: 'points', sources: pts };
  close(pts.reduce((a, s) => a + s.I, 0), 1, 1e-12, 'the points carry the whole brightness');
  let worst = 0;
  for (const [u, v] of [[0, 0], [3, 0], [0, 5], [-6, 4], [12, 12]]) {
    const [er, ei] = idealAt(model, pix, null, u, v), [sr, si] = idealAt(pm, pix, (k) => [pts[k].l, pts[k].m], u, v);
    worst = Math.max(worst, Math.hypot(er - sr, ei - si));
  }
  assert(worst < 4 / Math.sqrt(300), `worst difference ${worst.toFixed(3)} (sampling noise ~ ${(1 / Math.sqrt(300)).toFixed(3)})`);
  return `worst difference ${worst.toFixed(3)} for 300 points (1/√300 = ${(1 / Math.sqrt(300)).toFixed(3)})`;
});

// ------------------------------------------------------------------ many baselines (from the arrays demo)

test('an east-west baseline traces an ellipse of axis ratio sin(dec) as the Earth turns', () => {
  const lat = 34 * DEG;
  const pos = [stationXYZ(-500, 0, lat), stationXYZ(500, 0, lat)];
  for (const dec of [30, 60, 85]) {
    const tr = tracks(pos, { dec: dec * DEG, hours: 24, steps: 97, elMin: -Math.PI });
    const X = pos[1][0] - pos[0][0], Y = pos[1][1] - pos[0][1], Z = pos[1][2] - pos[0][2];
    for (let k = 0; k < tr.nt; k++) {
      const u = tr.u[k], v = tr.v[k];
      close(u * u + ((v - Z * Math.cos(dec * DEG)) / Math.sin(dec * DEG)) ** 2, X * X + Y * Y, 1e-6 * (X * X + Y * Y), `ellipse at dec ${dec}`);
    }
    close(Math.abs(Z), 0, 1e-6, 'an east-west baseline has no polar part');
  }
});

test('the dirty image is the sky convolved with the dirty beam: for a point source it is the beam itself', () => {
  const n = 64, lat = 34 * DEG;
  const pos = layout('random', { arm: 400, n: 6 }).dishes.map(([e, no]) => stationXYZ(e, no, lat));
  const tr = tracks(pos, { dec: 50 * DEG, hours: 6, steps: 31 });
  const pix = 2e-5, du = 1 / (n * pix), { S } = gridSamples(tr, 0.21, n, du);
  const beam = dirtyBeam(S, n), sky = new Float64Array(n * n);
  sky[(n / 2) * n + n / 2] = 1;
  const D = dirtyImage(S, skyTransform(sky, n), n);
  let worst = 0;
  for (let i = 0; i < D.length; i++) worst = Math.max(worst, Math.abs(D[i] - beam[i]));
  assert(worst < 1e-9, `dirty image vs beam: ${worst.toExponential(2)}`);
  close(beam[(n / 2) * n + n / 2], 1, 1e-12, 'the beam is 1 at the centre');
  return `agreement to ${worst.toExponential(1)}`;
});

test('CLEAN finds a point source: its flux and its position', () => {
  const n = 64, lat = 34 * DEG;
  const pos = layout('y', { arm: 600 }).dishes.map(([e, no]) => stationXYZ(e, no, lat));
  const tr = tracks(pos, { dec: 40 * DEG, hours: 4, steps: 41 });
  const pix = 1.2e-5, { S } = gridSamples(tr, 0.21, n, 1 / (n * pix), { weighting: 'uniform' });
  const B = dirtyBeam(S, n), sky = new Float64Array(n * n), i0 = 36, j0 = 28;
  sky[j0 * n + i0] = 1;
  const cs = cleanStart(dirtyImage(S, skyTransform(sky, n), n));
  cleanSteps(cs, B, n, { gain: 0.1, steps: 2000, threshold: 1e-4 });
  let best = 0;
  for (let i = 0; i < cs.model.length; i++) if (cs.model[i] > cs.model[best]) best = i;
  assert(best === j0 * n + i0, `the brightest component is at ${best % n}, ${Math.floor(best / n)}`);
  close(cs.model[best], 1, 0.02, 'its flux');
  const fit = fitBeam(B, n), R = restore(cs, fit, n);
  close(R[best], 1, 0.05, 'the restored image peaks at the source with its flux');
  return `${cs.iterations} steps, ${cs.components} components, flux ${cs.model[best].toFixed(4)}`;
});

test('layouts: the ring, the random array and the Y give n(n−1)/2 baselines', () => {
  for (const [kind, opts, count] of [['ring', { n: 8, arm: 100 }, 8], ['random', { n: 10, arm: 100 }, 10], ['y', { arm: 600 }, 27], ['line', {}, 8]]) {
    const { dishes } = layout(kind, opts);
    assert(dishes.length === count, `${kind}: ${dishes.length} dishes`);
    const tr = tracks(dishes.map(([e, no]) => stationXYZ(e, no, 34 * DEG)), { dec: 40 * DEG, hours: 0 });
    assert(tr.nb === (count * (count - 1)) / 2, `${kind}: ${tr.nb} baselines`);
  }
  const a = layout('random', { n: 5 }).dishes, b = layout('random', { n: 5 }).dishes;
  assert(a.every((d, i) => d[0] === b[i][0] && d[1] === b[i][1]), 'the random layout is repeatable');
  // The slides' line of eight: every spacing from 1 to 24 units.
  const line = layout('line', { unit: 1 }).dishes.map((d) => d[0]), spacings = new Set();
  for (let i = 0; i < 8; i++) for (let j = i + 1; j < 8; j++) spacings.add(Math.round(Math.abs(line[j] - line[i])));
  for (let s = 1; s <= 24; s++) assert(spacings.has(s), `the line misses a spacing of ${s}`);
  return `the line of eight measures ${spacings.size} different spacings, every one from 1 to 24`;
});

// ------------------------------------------------------------------ making the image: three ways

/** A sparse sampling of an n x n grid: a random array, an hour or so of Earth rotation, uniform weights. */
function sparse(n, pix, { dishes = 6, hours = 1, seed = 1 } = {}) {
  const pos = layout('random', { arm: 400, n: dishes, seed }).dishes.map(([e, no]) => stationXYZ(e, no, 34 * DEG));
  const tr = tracks(pos, { dec: 50 * DEG, hours, steps: 13 });
  return gridSamples(tr, 0.21, n, 1 / (n * pix), { weighting: 'uniform' }).S;
}
/** A smooth positive sky on an n x n grid: two Gaussian blobs in the middle. */
function blobs(n) {
  const sky = new Float64Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = i - n / 2, y = j - n / 2;
    sky[j * n + i] = Math.exp(-(x * x + y * y) / (2 * 3 * 3)) + 0.5 * Math.exp(-((x - 6) ** 2 + (y + 4) ** 2) / (2 * 2 * 2));
  }
  return sky;
}

test('the dirty image is the inverse transform of what was measured, every missing sample a zero: with every spacing measured it is the sky itself', () => {
  const n = 64, sky = blobs(n), V = skyTransform(sky, n);
  const all = dirtyImage(new Float64Array(n * n).fill(1), V, n);
  let worst = 0;
  for (let i = 0; i < sky.length; i++) worst = Math.max(worst, Math.abs(all[i] - sky[i]));
  assert(worst < 1e-12, `every spacing measured: the dirty image differs from the sky by ${worst.toExponential(2)}`);
  // Some spacings: the dirty image's own transform is (n²/W) S V, and exactly zero where S is.
  const S = sparse(n, 2e-5), D = dirtyImage(S, V, n), T = skyTransform(D, n);
  let W = 0, zero = 0, scale = 0, cells = 0, top = 0;
  for (let k = 0; k < S.length; k++) { W += S[k]; top = Math.max(top, Math.hypot(V.re[k], V.im[k])); }
  for (let k = 0; k < S.length; k++) {
    if (S[k] === 0) zero = Math.max(zero, Math.hypot(T.re[k], T.im[k]));
    else { scale = Math.max(scale, Math.hypot(T.re[k] - ((n * n) / W) * V.re[k], T.im[k] - ((n * n) / W) * V.im[k])); cells++; }
  }
  zero /= top; scale /= (n * n / W) * top;
  assert(zero < 1e-12 && scale < 1e-12, `the dirty image's transform: ${zero.toExponential(1)} of V(0) off the samples, ${scale.toExponential(1)} from (n²/W)V on them`);
  return `${cells} of ${n * n} cells measured; off them the dirty image's transform is ${zero.toExponential(0)} of V(0)`;
});

test('one CLEAN step takes gain × the peak out as a copy of the dirty beam centred on the peak; the window keeps the search in the field', () => {
  const n = 64, S = sparse(n, 2e-5, { dishes: 7 }), B = dirtyBeam(S, n), sky = new Float64Array(n * n);
  sky[30 * n + 34] = 1; sky[36 * n + 25] = 0.6; sky[3 * n + 60] = 3;      // the last one outside the field
  const D = dirtyImage(S, skyTransform(sky, n), n), box = [16, 16, 48, 48];
  const cs = cleanStart(D, box);
  let peak = -1;
  for (let j = 16; j < 48; j++) for (let i = 16; i < 48; i++) if (peak < 0 || Math.abs(D[j * n + i]) > Math.abs(D[peak])) peak = j * n + i;
  cleanSteps(cs, B, n, { gain: 0.25, steps: 1 });
  const g = 0.25 * D[peak], i0 = peak % n, j0 = (peak - i0) / n;
  let worst = 0;
  for (let j = 16; j < 48; j++) for (let i = 16; i < 48; i++) {
    const b = B[((j - j0 + n / 2 + n) % n) * n + ((i - i0 + n / 2 + n) % n)];
    worst = Math.max(worst, Math.abs(cs.residual[j * n + i] - (D[j * n + i] - g * b)));
  }
  assert(worst < 1e-14 && cs.log[0] === peak && cs.log[1] === g && cs.model[peak] === g, `one step: residual off by ${worst.toExponential(1)}; log ${cs.log}`);
  cleanSteps(cs, B, n, { gain: 0.1, steps: 500 });
  for (let k = 0; k < cs.log.length; k += 2) {
    const i = cs.log[k] % n, j = Math.floor(cs.log[k] / n);
    assert(i >= 16 && i < 48 && j >= 16 && j < 48, `step ${k / 2} took from (${i}, ${j}), outside the window`);
  }
  // Two points alone, with a Y for four hours: their fluxes come back, and restored with the
  // clean beam each becomes a Gaussian of its flux.
  const pos = layout('y', { arm: 600 }).dishes.map(([e, no]) => stationXYZ(e, no, 34 * DEG));
  const S2 = gridSamples(tracks(pos, { dec: 40 * DEG, hours: 4, steps: 41 }), 0.21, n, 1 / (n * 4e-5), { weighting: 'uniform' }).S, B2 = dirtyBeam(S2, n);
  sky[3 * n + 60] = 0;
  const c2 = cleanStart(dirtyImage(S2, skyTransform(sky, n), n), box);
  cleanSteps(c2, B2, n, { gain: 0.1, steps: 3000, threshold: 1e-4 });
  close(c2.model[30 * n + 34], 1, 0.02, 'the brighter point');
  close(c2.model[36 * n + 25], 0.6, 0.02, 'the fainter point');
  const R = restore(c2, fitBeam(B2, n), n);
  close(R[30 * n + 34], 1, 0.05, 'the restored image peaks at the brighter point with its flux');
  return `none of 500 steps outside the window; ${c2.iterations} steps, ${c2.components} components, fluxes ${c2.model[30 * n + 34].toFixed(3)} and ${c2.model[36 * n + 25].toFixed(3)}`;
});

/** Lambert's W: the w > 0 with w + ln w = L (that is, w e^w = e^L), by Newton's method. */
function lambertFromLog(L) {
  let w = L > 1 ? L - Math.log(L) : Math.exp(L);
  for (let k = 0; k < 60; k++) {
    const f = w + Math.log(w) - L, next = w - f / (1 + 1 / w);
    w = next > 0 ? next : w / 2;
    if (Math.abs(f) < 1e-15 * Math.max(1, Math.abs(L))) break;
  }
  return w;
}

test('maximum entropy with every spacing measured: each pixel solves α ln(I/M) = D − I, so I = α W((M/α) e^{D/α}) (Lambert’s W)', () => {
  const n = 64, sky = blobs(n), ones = new Float64Array(n * n).fill(1), B = dirtyBeam(ones, n), D = dirtyImage(ones, skyTransform(sky, n), n);
  const box = [16, 16, 48, 48], idx = windowIndices(n, box);
  let flux = 0;
  for (const o of idx) flux += sky[o];
  const notes = [];
  for (const a of [0.1, 0.01, 0.001]) {
    const ms = memStart(D, B, n, { alpha: a, flux, box }), M = flux / idx.length;
    memSteps(ms, { steps: 200, tol: 1e-9 });
    let worst = 0, outside = 0, fit = 0;
    for (let o = 0; o < n * n; o++) {
      const i = o % n, j = Math.floor(o / n), inside = i >= 16 && i < 48 && j >= 16 && j < 48;
      if (!inside) { outside = Math.max(outside, Math.abs(ms.model[o])); continue; }
      const exact = a * lambertFromLog(D[o] / a + Math.log(M / a));
      worst = Math.max(worst, Math.abs(ms.model[o] - exact) / exact);
      fit = Math.max(fit, Math.abs(ms.model[o] - D[o]));
    }
    assert(ms.done && worst < 1e-6 && outside === 0, `α = ${a}: ${ms.iterations} iterations, worst relative error ${worst.toExponential(2)}, ${outside} outside`);
    notes.push(`α ${a}: ${ms.iterations} its, to ${worst.toExponential(0)}, |I − D| ≤ ${fit.toFixed(4)}`);
    // As α shrinks the image approaches the data: |I − D| ~ α ln(D/M) where the sky is bright.
    if (a === 0.001) assert(fit < 0.02, `α = 0.001: the image is ${fit} from the dirty image`);
  }
  return notes.join('; ');
});

test('maximum entropy from a sparse uv plane: J only falls, no pixel goes negative, and the answer is I = M e^{R/α} at every pixel', () => {
  const n = 64, S = sparse(n, 2e-5, { dishes: 8, hours: 3 }), B = dirtyBeam(S, n), sky = blobs(n), D = dirtyImage(S, skyTransform(sky, n), n);
  const box = [16, 16, 48, 48], idx = windowIndices(n, box);
  let flux = 0, peak = 0;
  for (const o of idx) flux += sky[o];
  for (const v of D) peak = Math.max(peak, Math.abs(v));
  const alpha = 0.01 * peak, ms = memStart(D, B, n, { alpha, flux, box });
  memSteps(ms, { steps: 400, tol: 1e-7 });
  for (let k = 1; k < ms.objective.length; k++) assert(ms.objective[k] <= ms.objective[k - 1] + 1e-12 * Math.abs(ms.objective[0]), `J rose at iteration ${k}`);
  // The residual kept by the iterations is the true one.
  const kernel = beamKernel(B, n), BI = convolve(kernel, ms.model, null, new Float64Array(n * n));
  let rdrift = 0, worst = 0, low = Infinity;
  for (let o = 0; o < n * n; o++) rdrift = Math.max(rdrift, Math.abs(ms.residual[o] - (D[o] - BI[o])));
  for (const o of idx) {
    low = Math.min(low, ms.model[o]);
    const target = ms.default[o] * Math.exp(ms.residual[o] / alpha);
    if (ms.model[o] > 1e-6 * ms.default[o]) worst = Math.max(worst, Math.abs(ms.model[o] - target) / target);
  }
  assert(ms.done && worst < 1e-5 && low > 0 && rdrift < 1e-12, `${ms.iterations} iterations: I vs M e^{R/α} off by ${worst.toExponential(2)}, lowest pixel ${low}, residual drift ${rdrift.toExponential(1)}`);
  // And it is the minimum: a small change either way raises J.
  const J0 = ms.objective.at(-1), I = Float64Array.from(ms.model), dI = new Float64Array(n * n), rand = rng(5);
  for (const o of idx) dI[o] = (rand() - 0.5) * 0.01 * I[o];
  for (const s of [1, -1]) {
    const J = Float64Array.from(I, (v, o) => v + s * dI[o]), BJ = convolve(kernel, J, null, new Float64Array(n * n));
    let obj = 0;
    for (const o of idx) obj += -0.5 * J[o] * (D[o] + (D[o] - BJ[o])) + alpha * (J[o] * Math.log(J[o] / ms.default[o]) - J[o] + ms.default[o]);
    assert(obj > J0, `a nudge (${s > 0 ? '+' : '−'}) lowered J`);
  }
  return `${ms.iterations} iterations; I = M e^{R/α} to ${worst.toExponential(1)}; J fell from ${ms.objective[0].toExponential(3)} to ${J0.toExponential(3)}`;
});

test('maximum entropy keeps its image through the clean beam and its transform up to date as it goes: the same as restoring and transforming afresh', () => {
  const n = 64, S = sparse(n, 2e-5, { dishes: 8, hours: 3 }), B = dirtyBeam(S, n), sky = blobs(n), D = dirtyImage(S, skyTransform(sky, n), n);
  const box = [16, 16, 48, 48], idx = windowIndices(n, box), fit = fitBeam(B, n);
  let flux = 0, peak = 0;
  for (const o of idx) flux += sky[o];
  for (const v of D) peak = Math.max(peak, Math.abs(v));
  const opts = { alpha: 0.01 * peak, flux, box };
  const plain = memStart(D, B, n, opts), kept = memStart(D, B, n, { ...opts, smooth: cleanBeamKernel(fit, n) });
  const notes = [];
  for (const steps of [1, 7, 19]) {     // (to iteration 1, 8 and 27: across the exact recomputation at 20)
    memSteps(plain, { steps, tol: 1e-7 }); memSteps(kept, { steps, tol: 1e-7 });
    const fresh = restore(kept, fit, n), mine = memRestored(kept), tr = Float64Array.from(kept.model), ti = new Float64Array(n * n);
    fft2(tr, ti, n, n, -1);
    let dImg = 0, dT = 0, dPlain = 0, top = 0, ttop = 0, itop = 0;
    for (let o = 0; o < n * n; o++) {
      dImg = Math.max(dImg, Math.abs(mine[o] - fresh[o])); top = Math.max(top, Math.abs(fresh[o]));
      dT = Math.max(dT, Math.hypot(kept.transform[0][o] - tr[o], kept.transform[1][o] - ti[o])); ttop = Math.max(ttop, Math.hypot(tr[o], ti[o]));
      dPlain = Math.max(dPlain, Math.abs(kept.model[o] - plain.model[o])); itop = Math.max(itop, plain.model[o]);
    }
    // (The image itself is the one found without the clean beam, to rounding: the beams share a
    // transform, which changes the last bits, and conjugate gradients carry them on.)
    assert(dImg < 1e-9 * top && dT < 1e-9 * ttop && dPlain < 1e-8 * itop, `iteration ${kept.iterations}: restored off by ${dImg / top}, transform by ${dT / ttop}, the image itself by ${dPlain / itop}`);
    notes.push(`${kept.iterations}: ${(dImg / top).toExponential(0)}, ${(dT / ttop).toExponential(0)}, ${(dPlain / itop).toExponential(0)}`);
  }
  return `restored image, transform and image against fresh ones and the plain run, relative: ${notes.join('; ')}`;
});

test('CLEAN suits points, maximum entropy a smooth sky: a Y of 27 dishes for 8 hours at 5 GHz', () => {
  const lambda = 299792458 / 5e9, pix = ((20 / 3600) * DEG) / NS, du = 1 / (N * pix);
  const pos = layout('y', { arm: 16.2e3 }).dishes.map(([e, no]) => stationXYZ(e, no, 34 * DEG));
  const tr = tracks(pos, { dec: 40 * DEG, hours: 8, steps: 121 }), { S } = gridSamples(tr, lambda, N, du, { weighting: 'uniform' });
  const B = dirtyBeam(S, N), fit = fitBeam(B, N), box = [(N - NS) / 2, (N - NS) / 2, (N + NS) / 2, (N + NS) / 2], idx = windowIndices(N, box);
  const ones = new Float64Array(N * N).fill(1), out = {};
  for (const [name, model] of [['binary', { kind: 'points', sources: pointSources('binary', { scale: (5 / 3600) * DEG }) }], ['galaxy', { kind: 'picture', sky: normalise(galaxy(NS)) }]]) {
    const V = idealGrid(model, pix, (k) => [model.sources[k].l, model.sources[k].m]), D = dirtyImage(S, V, N), sky = dirtyImage(ones, V, N);
    const ref = restore({ model: sky, residual: new Float64Array(N * N) }, fit, N);
    let flux = 0, peak = 0;
    for (const o of idx) flux += sky[o];
    for (const v of D) peak = Math.max(peak, Math.abs(v));
    const cs = cleanStart(D, box);
    cleanSteps(cs, B, N, { gain: 0.1, steps: 1000, threshold: 0.01 * peak });
    const ms = memStart(D, B, N, { alpha: 0.01 * peak, flux, box });
    memSteps(ms, { steps: 200, tol: 1e-4 });
    out[name] = { dirty: rmsError(D, ref, idx), clean: rmsError(restore(cs, fit, N), ref, idx), mem: rmsError(restore(ms, fit, N), ref, idx), comps: cs.components, steps: cs.iterations, its: ms.iterations };
  }
  const { binary: b, galaxy: g } = out;
  assert(b.comps === 2 && b.clean < 1e-3 && b.clean < b.mem, `binary: CLEAN ${b.comps} components, error ${b.clean}; MEM ${b.mem}`);
  assert(g.mem < 0.5 * g.clean && g.clean < g.dirty, `galaxy: MEM ${g.mem}, CLEAN ${g.clean}, dirty ${g.dirty}`);
  const pc = (x) => `${(100 * x).toFixed(2)}%`;
  return `binary: dirty ${pc(b.dirty)}, CLEAN ${pc(b.clean)} (${b.comps} points, ${b.steps} steps), MEM ${pc(b.mem)} (${b.its} its); galaxy: dirty ${pc(g.dirty)}, CLEAN ${pc(g.clean)} (${g.steps} steps), MEM ${pc(g.mem)} (${g.its} its)`;
});

test('intensity correlations paint |V|², whose transform is the sky’s autocorrelation: a binary gives three points, a triangle a hexagon round a centre', () => {
  const pix = 1 / NS, ones = new Float64Array(N * N).fill(1), notes = [];
  // Points on pixels: a binary of 1 and 0.6, 12 pixels apart; a triangle (as near equilateral as pixels go).
  const cases = { binary: [[-6, 0, 1], [6, 0, 0.6]], triangle: [[0, 10, 1], [-9, -5, 1], [9, -5, 1]] };
  for (const [name, pts] of Object.entries(cases)) {
    const model = { kind: 'points', sources: pts.map(([x, y, I]) => ({ l: x * pix, m: y * pix, I })) };
    const V = idealGrid(model, pix, (k) => [model.sources[k].l, model.sources[k].m]);
    const V2 = { re: Float64Array.from(V.re, (r, k) => r * r + V.im[k] * V.im[k]), im: new Float64Array(N * N) };
    const A = dirtyImage(ones, V2, N), at = (dx, dy) => A[(N / 2 - dy) * N + N / 2 + dx];
    // The autocorrelation: Σ_jk I_j I_k δ(r − (r_j − r_k)).
    const expect = new Map();
    for (const [xj, yj, Ij] of pts) for (const [xk, yk, Ik] of pts) { const key = `${xj - xk},${yj - yk}`; expect.set(key, (expect.get(key) || 0) + Ij * Ik); }
    let worst = 0, total = 0, sum = 0;
    for (const [key, val] of expect) { const [dx, dy] = key.split(',').map(Number); worst = Math.max(worst, Math.abs(at(dx, dy) - val)); total += val; }
    for (const v of A) sum += v;
    assert(worst < 1e-9 && Math.abs(sum - total) < 1e-9, `${name}: the transform of |V|² differs from the autocorrelation by ${worst}`);
    const others = [...expect].filter(([k]) => k !== '0,0').map(([, v]) => v);
    notes.push(`${name}: ${expect.size} points, the centre ${at(0, 0).toFixed(2)} and ${others.length} of ${others[0].toFixed(2)}`);
  }
  return notes.join('; ');
});
