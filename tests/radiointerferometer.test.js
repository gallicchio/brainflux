import { test, assert, close } from './harness.js';
import { Simulation, M, sinc, binFrequency } from '../radiointerferometer/sim.js';
import { idealGrid, idealAt, idealWindow, samplePoints, pointSources, galaxy, normalise, N, NS } from '../radiointerferometer/sky.js';
import {
  stationXYZ, tracks, gridSamples, dirtyBeam, skyTransform, dirtyImage, cleanStart, cleanSteps, fitBeam, restore, layout,
} from '../radiointerferometer/synthesis.js';

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

test('the pair’s average converges to V = Σ I e^{−2πi(ul+vm)} within the radiometer scatter σ = √(P_A P_B / 2 β M/2) per chunk', () => {
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

test('the scatter of one chunk’s correlation is the radiometer value √(P_A P_B / 2N), N = β M/2 independent samples', () => {
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
    sim.random = rng(11); sim.band = band; sim.noise = 0; sim.alpha = 0.02;
    sim.sources = [{ l: 0, m: 0, I: 1 }];
    for (let i = 0; i < 300; i++) sim.step();
    const tmax = 3 / band, pts = 1201;
    sim.lags(tmax, pts);
    const R = sim.lagAA[0], h = (pts - 1) / 2;
    close(R[h], 1, 0.06, `band ${band}: R(0)`);
    let zero = -1;
    for (let i = h + 1; i < pts; i++) if (R[i - 1] > 0 && R[i] <= 0) { zero = ((i - h) * 2 * tmax) / (pts - 1); break; }
    close(zero * band, 1, 0.03, `band ${band}: first zero × Δν`);
    // The averaged spectrum: flat inside the band (each bin ~ power / bins), zero outside.
    const nb = sim.bandBins(), inBand = new Set(Array.from(sim.bins.subarray(0, nb)));
    let inside = 0, outside = 0, worst = 0;
    for (let b = 0; b < M; b++) {
      if (inBand.has(b)) { inside += sim.specAA[b]; worst = Math.max(worst, Math.abs(sim.specAA[b] * nb - 1)); } else outside += sim.specAA[b];
      assert(inBand.has(b) === (Math.abs(binFrequency(b) + 1 / M) <= band / 2 + 1e-9), `bin ${b} (f = ${binFrequency(b)}) in the band`);
    }
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
});
