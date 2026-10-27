import { test, assert, close } from './harness.js';
import { Sim1D, eigenstates, prepareSharpPotential } from '../schrodinger1d/sim.js';

function gaussianPacket(sim, x0, sigma, k0) {
  const re = new Float64Array(sim.n), im = new Float64Array(sim.n);
  for (let j = 0; j < sim.n; j++) {
    const x = sim.x[j], a = Math.exp(-((x - x0) ** 2) / (4 * sigma * sigma));
    re[j] = a * Math.cos(k0 * x); im[j] = a * Math.sin(k0 * x);
  }
  sim.setPsi(re, im);
  sim.normalize();
}

test('the norm is conserved (walls and periodic)', () => {
  for (const boundary of ['walls', 'periodic']) {
    const sim = new Sim1D({ n: 512, xmin: -10, xmax: 10, boundary });
    sim.setPotential(sim.x.map((x) => 0.5 * x * x));
    gaussianPacket(sim, 2, 0.6, 3);
    sim.step(0.01, 2000);
    close(sim.norm(), 1, 1e-11, boundary);
  }
});

test('a free Gaussian moves at p/m and spreads as sigma sqrt(1 + (t / 2 m sigma^2)^2)', () => {
  const sim = new Sim1D({ n: 4096, xmin: -60, xmax: 60, boundary: 'periodic' });
  const s0 = 1, k0 = 2, t = 5;
  gaussianPacket(sim, -10, s0, k0);
  sim.step(0.05, t / 0.05);
  const o = sim.observables();
  close(o.x, -10 + k0 * t, 1e-8, '<x>');
  close(o.sx, s0 * Math.sqrt(1 + (t / (2 * s0 * s0)) ** 2), 1e-8, 'sigma_x');
  close(o.p, k0, 1e-8, '<p>');
  close(o.sp, 1 / (2 * s0), 1e-8, 'sigma_p');
  close(o.E, (k0 * k0) / 2 + 1 / (8 * s0 * s0), 1e-8, '<E>');
});

test('harmonic oscillator levels are n + 1/2', () => {
  const n = 1024, sim = new Sim1D({ n, xmin: -12, xmax: 12, boundary: 'walls' });
  const V = sim.x.map((x) => 0.5 * x * x);
  const states = eigenstates(V, sim.dx, 1, 12, { first: 1, last: n - 1 });
  const worst = Math.max(...states.map((s, i) => Math.abs(s.E - (i + 0.5))));
  assert(worst < 2e-5, `worst level error ${worst}`);
  return `worst |E - (n+1/2)| for n < 12: ${worst.toExponential(1)}`;
});

test('box levels are n^2 pi^2 / 2 L^2', () => {
  const n = 1024, L = 10, sim = new Sim1D({ n, xmin: 0, xmax: L, boundary: 'walls' });
  const states = eigenstates(new Float64Array(n), sim.dx, 1, 8, { first: 1, last: n - 1 });
  for (let i = 0; i < 8; i++) {
    const exact = ((i + 1) ** 2 * Math.PI ** 2) / (2 * L * L);
    close(states[i].E, exact, 1e-7 * exact, `n=${i + 1}`);
  }
});

test('an eigenstate is stationary: |psi|^2 does not change, only the phase turns', () => {
  const n = 1024, sim = new Sim1D({ n, xmin: -12, xmax: 12, boundary: 'walls' });
  const V = sim.x.map((x) => 0.5 * x * x);
  sim.setPotential(V);
  const [, s1] = eigenstates(V, sim.dx, 1, 2, { first: 1, last: n - 1 });
  sim.setPsi(s1.psi, null);
  const before = sim.re.slice(0, n).map((r, j) => r * r);
  const sign0 = Math.sign(s1.psi[n / 2 + 40]);
  sim.step(0.01, 1000);
  let worst = 0, peak = 0;
  for (let j = 0; j < n; j++) {
    const p = sim.re[j] ** 2 + sim.im[j] ** 2;
    worst = Math.max(worst, Math.abs(p - before[j])); peak = Math.max(peak, before[j]);
  }
  assert(worst / peak < 1e-4, `relative change ${worst / peak}`);
  // The phase turns at E = 3/2: psi(t) = psi(0) exp(-i 1.5 t).
  const j = n / 2 + 40, ph = Math.atan2(sim.im[j] * sign0, sim.re[j] * sign0);
  const want = Math.atan2(Math.sin(-1.5 * sim.t), Math.cos(-1.5 * sim.t));
  close(Math.abs(Math.atan2(Math.sin(ph - want), Math.cos(ph - want))), 0, 2e-3, 'phase');
  return `max relative change of |psi|^2 over t = 10: ${(worst / peak).toExponential(1)}`;
});

test('a coherent state swings like the classical particle and keeps its width', () => {
  const sim = new Sim1D({ n: 1024, xmin: -12, xmax: 12, boundary: 'walls' });
  sim.setPotential(sim.x.map((x) => 0.5 * x * x));
  gaussianPacket(sim, 3, Math.SQRT1_2, 0);
  sim.step(Math.PI / 400, 400); // half a period
  const o = sim.observables();
  close(o.x, -3, 1e-5, '<x>');
  close(o.sx, Math.SQRT1_2, 1e-5, 'sigma_x');
  close(o.E, 0.5 + 4.5, 1e-5, '<E>');
});

test('running backwards undoes running forwards', () => {
  const sim = new Sim1D({ n: 512, xmin: -10, xmax: 10, boundary: 'walls' });
  sim.setPotential(sim.x.map((x) => (Math.abs(x) < 1 ? 3 : 0)));
  gaussianPacket(sim, -4, 0.8, 2.5);
  const r0 = sim.re.slice(), i0 = sim.im.slice();
  sim.step(0.01, 300);
  sim.step(-0.01, 300);
  let err = 0;
  for (let j = 0; j < sim.M; j++) err = Math.max(err, Math.abs(sim.re[j] - r0[j]), Math.abs(sim.im[j] - i0[j]));
  assert(err < 1e-10, `error ${err}`);
});

test('tunnelling through a square barrier agrees with the analytic T(E)', () => {
  // dx = 1/16, and the barrier's edges fall midway between grid points, so that the sampled
  // barrier is exactly 16 points = 1 wide.
  const V0 = 1, a = 1, k0 = 1.2, sigma = 12;
  const sim = new Sim1D({ n: 8192, xmin: -256, xmax: 256, boundary: 'periodic' });
  sim.setPotential(sim.x.map((x) => (Math.abs(x - 1 / 32) < a / 2 ? V0 : 0)));
  gaussianPacket(sim, -70, sigma, k0);
  sim.step(0.05, 140 / 0.05);
  const T = 1 - sim.probabilityLeftOf(a / 2);
  // Average the plane-wave T(k) over the packet's momentum distribution.
  const Tk = (k) => {
    const E = k * k / 2;
    if (E < V0) { const q = Math.sqrt(2 * (V0 - E)); return 1 / (1 + (V0 * V0 * Math.sinh(q * a) ** 2) / (4 * E * (V0 - E))); }
    const q = Math.sqrt(2 * (E - V0)); return 1 / (1 + (V0 * V0 * Math.sin(q * a) ** 2) / (4 * E * (E - V0)));
  };
  const sk = 1 / (2 * sigma);
  let num = 0, den = 0;
  for (let k = k0 - 6 * sk; k <= k0 + 6 * sk; k += sk / 50) {
    const w = Math.exp(-((k - k0) ** 2) / (2 * sk * sk)); num += w * Tk(k); den += w;
  }
  // The remaining difference is the O(dt^2) splitting error at the barrier's sharp edges: it
  // shrinks to 3e-4 at dt = 0.01 and dx = 1/64 (checked once; slow for every run).
  close(T, num / den, 1.5e-3, 'T');
  return `T = ${T.toFixed(5)}, analytic ${(num / den).toFixed(5)}`;
});

test('the absorbing layer swallows an outgoing packet with little reflection', () => {
  const sim = new Sim1D({ n: 2048, xmin: -40, xmax: 40, boundary: 'absorbing' });
  sim.absorbSpeed = 3;
  gaussianPacket(sim, 0, 2, 3);
  sim.step(0.02, 40 / 0.02);
  const left = sim.norm();
  assert(left < 2e-3, `left over ${left}`);
  close(sim.absorbed + left, 1, 1e-9, 'bookkeeping');
  return `probability left in the domain: ${left.toExponential(1)}`;
});

test('momentum space is normalised like position space', () => {
  const sim = new Sim1D({ n: 1024, xmin: -10, xmax: 10, boundary: 'walls' });
  gaussianPacket(sim, 1, 0.7, -2);
  const { re, im, dp } = sim.momentum();
  let s = 0;
  for (let i = 0; i < re.length; i++) s += (re[i] ** 2 + im[i] ** 2) * dp;
  close(s, 1, 1e-10);
});

test('sharp potentials: band-limited jumps and the step limit keep the energy and the levels grid-independent', () => {
  // A finite well and a tall box (cell-averaged, then rounded as the demo does), on two grids.
  const cell = (sim, f) => sim.x.map((x) => { let a = 0; for (let k = 0; k < 8; k++) a += f(x + ((k + 0.5) / 8 - 0.5) * sim.dx); return a / 8; });
  const notes = [];
  for (const [name, f] of [['finite well', (x) => (Math.abs(x) < 1 ? -5 : 0)], ['tall box', (x) => (Math.abs(x) > 1.5 ? 500 : 0)]]) {
    const E1 = [];
    for (const n of [1024, 4096]) {
      const sim = new Sim1D({ n, xmin: -15, xmax: 15, boundary: 'walls' });
      const V = prepareSharpPotential(cell(sim, f), sim.dx);
      assert(V.jumps, 'jumps found');
      sim.setPotential(V);
      const st = eigenstates(V, sim.dx, 1, 2, { first: 1, last: n - 1 });
      sim.setPsi(st[1].psi, null); sim.normalize();
      const dt = sim.suggestedStep(sim.observables().E), E0 = sim.observables().E;
      sim.step(dt, Math.round(10 / dt));
      close(sim.observables().E, E0, 2e-4 * Math.max(1, Math.abs(E0)), `${name} n=${n}: energy over t = 10`);
      E1.push(st[1].E);
    }
    close(E1[0], E1[1], 3e-3, `${name}: first excited level on two grids`);
    notes.push(`${name}: E1 = ${E1[1].toFixed(4)}`);
  }
  // Smooth potentials are left alone.
  const sim = new Sim1D({ n: 1024, xmin: -10, xmax: 10 });
  const V = sim.x.map((x) => 2 * Math.cos(2 * Math.PI * x) + 0.5 * x * x);
  const S = prepareSharpPotential(V, sim.dx);
  assert(!S.jumps && S.every((v, j) => v === V[j]), 'smooth potentials unchanged');
  return notes.join('; ');
});

test('a band-limited step reflects like a sharp one: R against ((k - k\')/(k + k\'))^2', () => {
  const V0 = 2, k0 = 2.4, sigma = 4;
  const sim = new Sim1D({ n: 4096, xmin: -60, xmax: 60, boundary: 'absorbing' });
  sim.absorbSpeed = 4;
  const cellV = sim.x.map((x) => { let a = 0; for (let k = 0; k < 8; k++) a += (x + ((k + 0.5) / 8 - 0.5) * sim.dx > 0 ? V0 : 0); return a / 8; });
  const V = prepareSharpPotential(cellV, sim.dx);
  sim.setPotential(V);
  const re = new Float64Array(sim.n), im = new Float64Array(sim.n);
  for (let j = 0; j < sim.n; j++) { const x = sim.x[j], a = Math.exp(-((x + 25) ** 2) / (4 * sigma * sigma)); re[j] = a * Math.cos(k0 * x); im[j] = a * Math.sin(k0 * x); }
  sim.setPsi(re, im); sim.normalize();
  const dt = sim.suggestedStep(sim.observables().E);
  sim.step(dt, Math.round(22 / dt));
  const R = sim.probabilityLeftOf(0) + sim.absorbedLeft;
  const Rk = (k) => { const E = k * k / 2; if (E <= V0) return 1; const q = Math.sqrt(k * k - 2 * V0); return ((k - q) / (k + q)) ** 2; };
  const sk = 1 / (2 * sigma);
  let num = 0, den = 0;
  for (let k = k0 - 6 * sk; k <= k0 + 6 * sk; k += sk / 50) { const w = Math.exp(-((k - k0) ** 2) / (2 * sk * sk)); num += w * Rk(k); den += w; }
  close(R, num / den, 0.003, 'R');
  return `R = ${R.toFixed(4)}, sharp-step analytic ${(num / den).toFixed(4)}, dt = ${dt.toFixed(4)}`;
});

test('the delta well: one bound state at -alpha^2/2, and T = k^2/(k^2 + alpha^2)', () => {
  const alpha = 1, w = 0.05, k0 = 1, sigma = 6;
  const sim = new Sim1D({ n: 4096, xmin: -80, xmax: 80, boundary: 'absorbing' });
  sim.absorbSpeed = 2;
  const f = (x) => (Math.abs(x) < w / 2 ? -alpha / w : 0);
  const cellV = sim.x.map((x) => { let a = 0; for (let k = 0; k < 8; k++) a += f(x + ((k + 0.5) / 8 - 0.5) * sim.dx); return a / 8; });
  // The bound state has a cusp at the delta, so it needs a high band limit (the preset's 40).
  const V = prepareSharpPotential(cellV, sim.dx, { kc: 40 });
  assert(V.jumps, 'the spike is seen as sharp');
  sim.setPotential(V);
  const bound = eigenstates(V, sim.dx, 1, 2, { first: 0, last: sim.n - 1 }).filter((s) => s.E < 0);
  assert(bound.length === 1, `${bound.length} bound states`);
  // A delta has a cusp in its bound state, which needs the shortest wavelengths; a well 0.05
  // wide, cell-averaged and band-limited, binds a little above -alpha^2/2 (-0.45 here).
  close(bound[0].E, -alpha * alpha / 2, 0.06, 'bound state');
  const re = new Float64Array(sim.n), im = new Float64Array(sim.n);
  for (let j = 0; j < sim.n; j++) { const x = sim.x[j], a = Math.exp(-((x + 30) ** 2) / (4 * sigma * sigma)); re[j] = a * Math.cos(k0 * x); im[j] = a * Math.sin(k0 * x); }
  sim.setPsi(re, im); sim.normalize();
  const E0 = sim.observables().E, dt = sim.suggestedStep(E0);
  sim.step(dt, Math.round(60 / dt));
  const T = 1 - sim.probabilityLeftOf(0) - sim.absorbedLeft;
  const sk = 1 / (2 * sigma);
  let num = 0, den = 0;
  for (let k = k0 - 6 * sk; k <= k0 + 6 * sk; k += sk / 50) { const g = Math.exp(-((k - k0) ** 2) / (2 * sk * sk)); num += g * k * k / (k * k + alpha * alpha); den += g; }
  // The well's width (0.05, and about 0.08 once band-limited) raises T a little: an exact
  // square well 0.05 wide and 20 deep transmits 0.509 at k = 1 where a delta transmits 0.5.
  close(T, num / den, 0.03, 'T');
  return `E = ${bound[0].E.toFixed(4)}, T = ${T.toFixed(4)} (analytic ${(num / den).toFixed(4)})`;
});
