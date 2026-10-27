import { test, assert, close } from './harness.js';
import { Sim2D, Packet, Detector, fromPartialWaves, bornCrossSection, hardDiskWaves } from '../schrodinger2d/sim.js';

function setup({ n = 128, L = 64, absorb = true, V, packet }) {
  const sim = new Sim2D({ n, L, absorb });
  const N = n * n, Vg = new Float64Array(N);
  if (V) for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) Vg[j * n + i] = V(sim.coord[i], sim.coord[j]);
  sim.setPotential(Vg);
  const p = new Packet(packet);
  const re = new Float64Array(N), im = new Float64Array(N);
  p.grid(sim, 0, re, im);
  sim.setPsi(re, im);
  return { sim, p };
}

test('a free packet follows the exact Gaussian evolution', () => {
  const { sim, p } = setup({ absorb: false, packet: { x0: -6, y0: 2, sx: 1.5, sy: 2, k0: 2 } });
  close(sim.norm(), 1, 1e-9, 'normalised');
  for (let s = 0; s < 200; s++) sim.step(0.025);
  const re = new Float64Array(sim.re.length), im = new Float64Array(sim.re.length);
  p.grid(sim, sim.t, re, im);
  let err = 0, peak = 0;
  for (let i = 0; i < re.length; i++) { err = Math.max(err, Math.hypot(sim.re[i] - re[i], sim.im[i] - im[i])); peak = Math.max(peak, Math.hypot(re[i], im[i])); }
  assert(err / peak < 1e-8, `relative error ${err / peak}`);
  close(sim.norm(), 1, 1e-9, 'unitary');
});

// The box must keep the incident packet's tails clear of the absorbing layer: where the layer
// eats into psi but not into the exact psi_inc, a spurious "scattered" wave appears.
function scatter(V, { k0 = 2, R = 16, dt = 0.025, T = 25, a = 2 } = {}) {
  const { sim, p } = setup({ V, packet: { x0: -12, y0: 0, sx: 2.5, sy: 6, k0 } });
  sim.absorbSpeed = k0 + 1;
  const det = new Detector(R, 256);
  det.reset(p.energy);
  while (sim.t < T) { sim.step(dt); det.record(sim, p, dt); }
  void a;
  return { sim, p, det };
}

test('weak Gaussian bump: the flux cross section agrees with the Born approximation', () => {
  const V0 = 0.05, a = 1, k0 = 2;
  const { sim, p, det } = scatter((x, y) => V0 * Math.exp(-(x * x + y * y) / (2 * a * a)), { k0 });
  const th = Array.from(det.theta), dth = (2 * Math.PI) / th.length;
  const sigmaBorn = (k) => bornCrossSection(sim, k, th).reduce((s, v) => s + v * dth, 0);
  const sBorn = sigmaBorn(k0);
  // What a flux measurement sees: Born averaged over the packet's wavenumbers, weighted by the
  // probability arriving at each (|a(k)|^2 v).
  const sk = 1 / (2 * p.sx);
  let num = 0, den = 0;
  for (let k = k0 - 3 * sk; k <= k0 + 3 * sk; k += sk / 4) { const w = Math.exp(-((k - k0) ** 2) / (2 * sk * sk)); num += w * sigmaBorn(k); den += w; }
  const sAvg = num / den;
  const tot = det.totals();
  const pw = fromPartialWaves(det.partialWaves(k0, 20, p), k0, th);
  const note = `sigma: Born(k0) ${sBorn.toFixed(5)}, Born averaged over the packet ${sAvg.toFixed(5)}, flux ${tot.scattered.toFixed(5)}, shadow ${tot.shadow.toFixed(5)}, partial waves ${pw.sigma.toFixed(5)}, optical ${pw.optical.toFixed(5)}`;
  close(tot.scattered / sAvg, 1, 0.03, 'flux / packet-averaged Born: ' + note);
  close(tot.shadow / tot.scattered, 1, 0.02, 'shadow / flux: ' + note);
  close(pw.sigma / sBorn, 1, 0.03, 'partial waves / Born: ' + note);
  close(pw.optical / pw.sigma, 1, 0.06, 'optical theorem (a second-order effect here): ' + note);
  return note;
});

test('a tall disk: unitary S-matrix, and three total cross sections that agree (optical theorem)', () => {
  const V0 = 20, a = 1.5, w = 0.2, k0 = 2;
  const { p, det } = scatter((x, y) => V0 / (1 + Math.exp((Math.hypot(x, y) - a) / w)), { k0, dt: 0.015 });
  const waves = det.partialWaves(k0, 20, p);
  let worst = 0;
  for (const s of waves) if (Math.abs(s.m) <= 6) worst = Math.max(worst, Math.abs(Math.hypot(s.Sre, s.Sim) - 1));
  assert(worst < 0.01, `|S_m| - 1 up to ${worst}`);
  const pw = fromPartialWaves(waves, k0, Array.from(det.theta));
  const tot = det.totals();
  close(pw.optical / pw.sigma, 1, 0.01, 'optical theorem');
  close(tot.scattered / pw.sigma, 1, 0.05, 'flux (averaged over the packet) vs partial waves (at k0)');
  close(tot.shadow / tot.scattered, 1, 0.01, 'the shadow removes what is scattered');
  // Compare with a hard disk of about the same radius.
  const hd = fromPartialWaves(hardDiskWaves(k0, a), k0, [0]);
  return `|S|-1 <= ${worst.toExponential(1)}; sigma: partial waves ${pw.sigma.toFixed(3)}, optical ${pw.optical.toFixed(3)}, flux ${tot.scattered.toFixed(3)}, shadow ${tot.shadow.toFixed(3)}; hard disk a=${a}: ${hd.sigma.toFixed(3)}`;
});
