import { test, assert, close } from './harness.js';
import { Sim2D, Packet, Detector, fromPartialWaves, bornCrossSection, hardDiskWaves, radialWaves, fraunhofer, preparePotential2D } from '../schrodinger2d/sim.js';
import { besselJ } from '../lib/bessel.js';

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

test('the radial equation gives the hard disk\'s phase shifts, and the tall disk\'s match the movie', () => {
  // A very tall, very sharp disk is a hard disk.
  const k = 2, a = 1.5;
  const hard = radialWaves((r) => r.map((x) => 1e4 / (1 + Math.exp((x - a) / 0.002))), k, 12, { h: 0.0005, rmax: 4 });
  const exact = hardDiskWaves(k, a, 12);
  let worst = 0;
  for (let i = 0; i < exact.length; i++) worst = Math.max(worst, Math.hypot(hard[i].Sre - exact[i].Sre, hard[i].Sim - exact[i].Sim));
  assert(worst < 0.03, `hard disk S_m off by up to ${worst}`);
  // The tall soft disk of the earlier test: the time-dependent S_m against the stationary ones.
  const V0 = 20, w = 0.2;
  const { p, det } = scatter((x, y) => V0 / (1 + Math.exp((Math.hypot(x, y) - a) / w)), { k0: k, dt: 0.015 });
  const movie = det.partialWaves(k, 12, p);
  const still = radialWaves((r) => r.map((x) => V0 / (1 + Math.exp((x - a) / w))), k, 12);
  let worst2 = 0;
  for (let i = 0; i < movie.length; i++) if (Math.abs(movie[i].m) <= 6) worst2 = Math.max(worst2, Math.hypot(movie[i].Sre - still[i].Sre, movie[i].Sim - still[i].Sim));
  assert(worst2 < 0.03, `movie against stationary S_m off by up to ${worst2}`);
  const s1 = fromPartialWaves(movie, k, [0]).sigma, s2 = fromPartialWaves(still, k, [0]).sigma;
  close(s1 / s2, 1, 0.01, 'sigma');
  return `hard disk |dS| <= ${worst.toExponential(1)}; movie vs stationary |dS| <= ${worst2.toExponential(1)}; sigma ${s1.toFixed(4)} vs ${s2.toFixed(4)}`;
});

// The probability through the detector within centre +- half (degrees), from dP/dtheta.
function share(det, P, centre, half) {
  let s = 0;
  for (let j = 0; j < det.M; j++) {
    const d = ((((det.theta[j] * 180) / Math.PI - centre) % 360) + 540) % 360 - 180;
    if (Math.abs(d) <= half) s += (P[j] * 2 * Math.PI) / det.M;
  }
  return s;
}

test('the demo\'s bump, V0 = 1: a sixth of the packet scattered, and Born still close', () => {
  const V0 = 1, a = 1, k0 = 2;
  const { sim, det } = scatter((x, y) => V0 * Math.exp(-(x * x + y * y) / (2 * a * a)), { k0, dt: 0.05 });
  const th = Array.from(det.theta), dth = (2 * Math.PI) / th.length;
  const P = share(det, det.Psc, 0, 180), tot = det.totals();
  const sBorn = bornCrossSection(sim, k0, th).reduce((s, v) => s + v * dth, 0);
  const sExact = fromPartialWaves(radialWaves((r) => r.map((x) => V0 * Math.exp(-x * x / (2 * a * a))), k0, 24), k0, [0]).sigma;
  const note = `scattered ${P.toFixed(3)} of the packet; sigma: flux ${tot.scattered.toFixed(3)}, exact ${sExact.toFixed(3)}, Born ${sBorn.toFixed(3)}`;
  assert(P > 0.12, 'too little scattered to see: ' + note);
  close(tot.scattered / sExact, 1, 0.05, 'flux (over the packet\'s energies) vs exact: ' + note);
  assert(sBorn / sExact > 1.02 && sBorn / sExact < 1.12, 'Born a few per cent high: ' + note);
  return note;
});

test('the flux of psi itself: a free packet goes through the far half of the detector whole', () => {
  const { det } = scatter(null, { dt: 0.05 });
  const sy = 6, through = share(det, det.Ptot, 0, 90) / det.fluence;
  // Per unit fluence at the centre, a Gaussian beam is sqrt(2 pi) sy wide.
  close(through / (Math.sqrt(2 * Math.PI) * sy), 1, 0.03, `through ${through.toFixed(3)}`);
  return `${through.toFixed(3)} against sqrt(2 pi) sy = ${(Math.sqrt(2 * Math.PI) * sy).toFixed(3)}`;
});

test('Fraunhofer: the double slit over every direction of the half circle', () => {
  const k = 2, a = 1.2, d = 5, dy = 0.002, ys = [];
  for (let y = -d / 2 - a / 2 + dy / 2; y < d / 2 + a / 2; y += dy) if (Math.abs(Math.abs(y) - d / 2) < a / 2) ys.push(y);
  const ones = ys.map(() => 1), zeros = ys.map(() => 0);
  const deg = Array.from({ length: 3601 }, (_, i) => -180 + i / 10), th = deg.map((t) => (t * Math.PI) / 180);
  const s = fraunhofer(k, ys, ones, zeros, dy, th);
  // Against the formula: (k/2pi) cos^2 [2 a cos(kd sin/2) sinc(ka sin/2)]^2.
  let worst = 0;
  for (let i = 0; i < th.length; i++) {
    const c = Math.cos(th[i]), u = k * Math.sin(th[i]);
    const f = c > 0 ? (k / (2 * Math.PI)) * c * c * (2 * a * Math.cos((u * d) / 2) * (u ? Math.sin((u * a) / 2) / ((u * a) / 2) : 1)) ** 2 : 0;
    worst = Math.max(worst, Math.abs(s[i] - f));
  }
  assert(worst < 1e-4, `off the formula by ${worst}`);
  // Every direction from -90 to 90 degrees, and nothing behind the wall.
  const at = (t) => s[Math.round((t + 180) * 10)];
  assert(at(-89.9) > 0 && at(89.9) > 0 && at(90.1) === 0 && at(-120) === 0, 'the half circle');
  // Dark fringes at d sin(theta) = (n + 1/2) lambda, +-18.3 and +-70.4 degrees, and a bright
  // one between them near d sin(theta) = lambda, 38.9 degrees (the falling envelopes pull it in).
  const lam = (2 * Math.PI) / k, asd = (x) => Math.round(Math.asin(x) * 1800 / Math.PI) / 10;
  for (const t of [asd(lam / 2 / d), asd((3 * lam) / 2 / d)]) assert(at(t) < 2e-3 * at(0) && at(-t) < 2e-3 * at(0), `dark fringe at ${t}`);
  const fringe = asd(lam / d);
  let best = 30;
  for (let t = 300; t < 500; t++) if (at(t / 10) > at(best)) best = t / 10;
  close(best, fringe, 4, 'first bright fringe');
  // A wide opening lets the whole beam through: per unit fluence, sqrt(2 pi) sy.
  const sy = 6, wide = [], amp = [];
  for (let y = -40; y < 40; y += 0.01) { wide.push(y); amp.push(Math.exp(-(y * y) / (4 * sy * sy))); }
  const all = fraunhofer(k, wide, amp, wide.map(() => 0), 0.01, th).reduce((acc, v) => acc + (v * 0.1 * Math.PI) / 180, 0);
  close(all / (Math.sqrt(2 * Math.PI) * sy), 1, 0.01, 'wide opening');
  return `first fringe at ${best} degrees (d sin = lambda: ${fringe.toFixed(1)}); at 89.9 degrees ${at(89.9).toExponential(1)}; wide opening ${all.toFixed(3)}`;
});

// The demo's crystal: 7 x 7 atoms c = 2 apart, turned by alpha, in a beam of wavelength 2 (as
// app.js sets it up: 256 x 256 grid, box 64, packet sx = 2.2, sy = 3).
function bragg(alpha) {
  const n = 256, sim = new Sim2D({ n, L: 64 }), c = 2, s = 0.3, V0 = 2, k0 = Math.PI, sx = 2.2, sy = 3;
  const ca = Math.cos((alpha * Math.PI) / 180), sa = Math.sin((alpha * Math.PI) / 180), N = n * n, V = new Float64Array(N);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const u = ca * sim.coord[i] + sa * sim.coord[j], v = -sa * sim.coord[i] + ca * sim.coord[j];
    if (Math.abs(u) < 3.5 * c && Math.abs(v) < 3.5 * c) V[j * n + i] = V0 * Math.exp(-((u - c * Math.round(u / c)) ** 2 + (v - c * Math.round(v / c)) ** 2) / (2 * s * s));
  }
  sim.setPotential(preparePotential2D(V, n, sim.dx).V);
  sim.absorbSpeed = k0 + 4 / sx;
  const x0 = -(sim.inner - 3.6 * sx), p = new Packet({ x0, sx, sy, k0 }), re = new Float64Array(N), im = new Float64Array(N);
  p.grid(sim, 0, re, im);
  sim.setPsi(re, im);
  const det = new Detector(18, 256);
  det.reset(p.energy);
  const T = (Math.abs(x0) + 18 + 4 * sx) / (k0 - 1 / sx) + 6;
  while (sim.t < T) { sim.step(0.05); det.record(sim, p, 0.05); }
  return share(det, det.Psc, 2 * alpha, 15);
}

test('Bragg: at 2c sin(alpha) = lambda the crystal reflects to 2 alpha; off it, hardly', () => {
  const on = bragg(30), off = bragg(20);
  const note = `within 15 degrees of 2 alpha: ${on.toFixed(3)} of the packet at alpha = 30, ${off.toFixed(3)} at 20`;
  assert(on > 0.2 && on > 4 * off, note);
  return note;
});

// The first Born approximation in two dimensions, with psi -> e^{ikx} + f e^{ikr}/sqrt(r):
// f = -(m/hbar^2) (2 pi k)^-1/2 e^{i pi/4} V~(q), so dsigma/dtheta = m^2 |V~(q)|^2 / (2 pi hbar^4 k).
// For a Gaussian bump V0 exp(-r^2/2a^2), V~(q) = 2 pi a^2 V0 exp(-q^2 a^2/2) in closed form; and
// its partial-wave form, delta_m = -pi (m/hbar^2) integral V J_m^2(kr) r dr, must give the same
// cross section through sigma = (4/k) sum delta_m^2, and agree with the radial equation when
// the bump is weak.
test('Born in 2D: the closed form, the grid sum and Born\'s own phase shifts agree, and so does the radial equation for a weak bump', () => {
  const V0 = 0.05, a = 1, k = 2, V = (r) => V0 * Math.exp(-(r * r) / (2 * a * a));
  const th = Array.from({ length: 360 }, (_, i) => ((i - 180) * Math.PI) / 180), dth = Math.PI / 180;
  const exactBorn = th.map((t) => { const q = 2 * k * Math.sin(t / 2); return (2 * Math.PI * a ** 4 * V0 * V0 * Math.exp(-q * q * a * a)) / k; });
  const { sim } = setup({ n: 128, L: 32, V: (x, y) => V(Math.hypot(x, y)), packet: {} });
  const grid = bornCrossSection(sim, k, th), fwd = Math.max(...exactBorn);
  let worst = 0;
  for (let i = 0; i < th.length; i++) worst = Math.max(worst, Math.abs(grid[i] - exactBorn[i]) / fwd);
  assert(worst < 1e-3, `the grid sum is off the closed form by ${worst} of the forward value`);
  // Born's phase shifts by quadrature, and the partial-wave total.
  const mmax = 12, h = 0.002, d = new Float64Array(mmax + 1);
  for (let r = h / 2; r < 8; r += h) { const J = besselJ(mmax, k * r); for (let m = 0; m <= mmax; m++) d[m] -= Math.PI * V(r) * J[m] * J[m] * r * h; }
  const waves = [];
  for (let m = -mmax; m <= mmax; m++) waves.push({ m, Sre: Math.cos(2 * d[Math.abs(m)]), Sim: Math.sin(2 * d[Math.abs(m)]) });
  const pw = fromPartialWaves(waves, k, th);
  const sBorn = exactBorn.reduce((acc, v) => acc + v * dth, 0), sPW = (4 / k) * waves.reduce((acc, w) => acc + Math.sin(d[Math.abs(w.m)]) ** 2, 0);
  close(sPW / sBorn, 1, 2e-3, `partial-wave Born total ${sPW} vs the closed form's ${sBorn}`);
  let worstF = 0;
  for (let i = 0; i < th.length; i++) worstF = Math.max(worstF, Math.abs(pw.f[i][0] ** 2 + pw.f[i][1] ** 2 - exactBorn[i]) / fwd);
  assert(worstF < 3e-3, `|f|^2 from Born's phase shifts is off the closed form by ${worstF} of the forward value`);
  // The radial equation's phase shifts: second order in V0 away from Born's.
  const exact = radialWaves((r) => r.map(V), k, mmax);
  let worstD = 0;
  for (let m = 0; m <= 4; m++) { const e = exact.find((w) => w.m === m); worstD = Math.max(worstD, Math.abs(Math.atan2(e.Sim, e.Sre) / 2 - d[m])); }
  assert(d[0] < 0 && worstD < 2e-3, `the radial equation's delta_m differ from Born's by up to ${worstD}; delta_0 = ${d[0]}`);
  return `delta_0 Born ${d[0].toFixed(5)}, exact ${(Math.atan2(exact.find((w) => w.m === 0).Sim, exact.find((w) => w.m === 0).Sre) / 2).toFixed(5)}; sigma Born ${sBorn.toFixed(5)}, from its phase shifts ${sPW.toFixed(5)}; grid sum within ${worst.toExponential(1)}`;
});

// The optical theorem's phase factor in 2D: sigma_total = -sqrt(8 pi/k) Re[e^{i pi/4} f(0)]
// (= sqrt(8 pi/k) Im[e^{-i pi/4} f(0)]) is the elastic sum (1/k) sum |S_m - 1|^2 plus the
// absorbed part (1/k) sum (1 - |S_m|^2): equal to the elastic cross section exactly when every
// |S_m| = 1, and more than it for an absorbing target.
test('the optical theorem in 2D: its phase factor, for unitary and for absorbing S_m', () => {
  const k = 1.7, mk = (eta) => Array.from({ length: 9 }, (_, i) => { const m = i - 4, d = 0.9 * Math.exp(-0.4 * m * m) * (m % 2 ? -1 : 1); return { m, Sre: eta * Math.cos(2 * d), Sim: eta * Math.sin(2 * d) }; });
  const th = Array.from({ length: 720 }, (_, i) => (i * Math.PI) / 360), dth = Math.PI / 360;
  for (const eta of [1, 0.8]) {
    const waves = mk(eta), pw = fromPartialWaves(waves, k, th);
    const integral = pw.f.reduce((acc, [re, im]) => acc + (re * re + im * im) * dth, 0);
    close(integral / pw.sigma, 1, 1e-6, `integral of |f|^2 against (1/k) sum |S - 1|^2, eta = ${eta}`);
    const absorbed = waves.reduce((acc, w) => acc + (1 - w.Sre ** 2 - w.Sim ** 2), 0) / k;
    close(pw.optical, pw.sigma + absorbed, 1e-9, `optical theorem, eta = ${eta}: elastic ${pw.sigma} + absorbed ${absorbed}`);
    // The same number in the Im form.
    const f0 = pw.f[0], imForm = Math.sqrt((8 * Math.PI) / k) * (f0[1] * Math.cos(Math.PI / 4) - f0[0] * Math.sin(Math.PI / 4));
    close(imForm, pw.optical, 1e-9, 'sqrt(8 pi/k) Im[e^{-i pi/4} f(0)]');
  }
});
