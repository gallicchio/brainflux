import { test, assert, close } from './harness.js';
import { solve, rtBoth, field, rt, absorbedByLayer, makeWorkspace, sweepLayer, incidentE2, phaseDifference } from '../thinfilms/tmm.js';
import { MATERIALS } from '../thinfilms/materials.js';
import { cmf, colorimeter, wavelengths, chromaticity, toDisplay } from '../thinfilms/color.js';
import { parseDesign, expandDesign, drainingThickness } from '../thinfilms/design.js';

const deg = Math.PI / 180;
// A repeatable pseudo-random sequence.
function rng(seed) { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32); }
const arrays = (layers) => [Float64Array.from(layers, (l) => l[0]), Float64Array.from(layers, (l) => l[1]), Float64Array.from(layers, (l) => l[2])];

test('lossless stacks: R + T = 1 for s and p at any angle; R = 1 beyond the critical angle', () => {
  const rand = rng(1);
  let worst = 0, tir = 0;
  for (let trial = 0; trial < 300; trial++) {
    const L = Math.floor(rand() * 8), n0 = 1 + rand(), ns = [1 + 1.5 * rand(), 0];
    const layers = Array.from({ length: L }, () => [1 + 1.6 * rand(), 0, 600 * rand()]);
    const theta = 89 * rand(), lam = 400 + 400 * rand();
    for (const pol of ['s', 'p']) {
      const { R, T } = rt(n0, layers, ns, lam, theta, pol);
      worst = Math.max(worst, Math.abs(R + T - 1));
      if (n0 * Math.sin(theta * deg) > ns[0]) { tir++; close(T, 0, 1e-15, 'T beyond the critical angle'); close(R, 1, 1e-12, 'R beyond the critical angle'); }
    }
  }
  assert(worst < 1e-12, `max |R + T - 1| = ${worst}`);
  return `max |R + T - 1| = ${worst.toExponential(1)} over 600 cases (${tir} of them totally reflected)`;
});

test('absorbing stacks: R + T + A = 1, with A integrated from the field inside each layer', () => {
  const lam = 600, silver = MATERIALS.silver.index(lam);
  const cases = [
    [1, [[1.5, 0.02, 200], [silver[0], silver[1], 30], [2.1, 0, 80]], [1.5, 0], 30],
    [1.5, [[silver[0], silver[1], 45]], [1.33, 0], 70],     // the plasmon geometry
    [1, [[2.0, 0.3, 120], [1.4, 0, 100], [3.5, 1.2, 15]], [1.52, 0], 0],
  ];
  let worst = 0;
  for (const [n0, layers, ns, theta] of cases) for (const pol of ['s', 'p']) {
    const [nr, ni, d] = arrays(layers), ws = makeWorkspace(layers.length);
    const { R, T, A } = solve(n0, nr, ni, d, ns, lam, n0 * Math.sin(theta * deg), pol, ws);
    const parts = absorbedByLayer(ws, 800), sum = parts.reduce((a, b) => a + b, 0);
    worst = Math.max(worst, Math.abs(R + T + sum - 1));
    assert(A > 0.01, `some absorption (${A})`);
  }
  assert(worst < 1e-7, `max |R + T + A_field - 1| = ${worst}`);
  return `max |R + T + A - 1| = ${worst.toExponential(1)}`;
});

test('one interface at normal incidence: R = |(n1 - N2)/(n1 + N2)|^2, also for a metal', () => {
  for (const [n1, n2, k2] of [[1, 1.5, 0], [1.5, 1, 0], [1.33, 2.4, 0], [1, 0.14, 3.6], [1, 0.3, 3.1]]) {
    const expected = ((n1 - n2) ** 2 + k2 * k2) / ((n1 + n2) ** 2 + k2 * k2);
    for (const pol of ['s', 'p']) close(rt(n1, [], [n2, k2], 550, 0, pol).R, expected, 1e-14, `${n1} | ${n2}+${k2}i`);
  }
});

test('one interface at an angle: the Fresnel amplitudes r_s and r_p, phases included', () => {
  const n1 = 1.2, n2 = 1.7;
  for (const th of [0, 10, 33, 50, 71, 85]) {
    const c1 = Math.cos(th * deg), s2 = (n1 / n2) * Math.sin(th * deg), c2 = Math.sqrt(1 - s2 * s2);
    const rs = (n1 * c1 - n2 * c2) / (n1 * c1 + n2 * c2), rp = (n1 * c2 - n2 * c1) / (n1 * c2 + n2 * c1);
    const s = rt(n1, [], [n2, 0], 500, th, 's'), p = rt(n1, [], [n2, 0], 500, th, 'p');
    close(s.rr, rs, 1e-14, `r_s at ${th}`); close(s.ri, 0, 1e-14);
    close(p.rr, rp, 1e-14, `r_p at ${th}`); close(p.ri, 0, 1e-14);
  }
});

test("Brewster's angle: R_p = 0 at tan(theta_B) = n2/n1, and nowhere else", () => {
  for (const [n1, n2] of [[1, 1.5168], [1, 1.333], [1.5, 1], [1.33, 1.5]]) {
    const thB = Math.atan(n2 / n1) / deg;
    const Rp = rt(n1, [], [n2, 0], 550, thB, 'p').R;
    assert(Rp < 1e-28, `R_p(${thB.toFixed(2)}) = ${Rp}`);
    // The minimum over a fine grid is there.
    let best = 0, bestR = Infinity;
    for (let th = 0; th < 89.99; th += 0.01) { const R = rt(n1, [], [n2, 0], 550, th, 'p').R; if (R < bestR) { bestR = R; best = th; } }
    close(best, thB, 0.006, 'the minimum');
  }
  return `air to BK7: theta_B = ${(Math.atan(1.5168) / deg).toFixed(2)} deg`;
});

test('quarter-wave antireflection coating: R = ((n0 ns - n1^2)/(n0 ns + n1^2))^2', () => {
  const lam = 550;
  for (const [n0, n1, ns] of [[1, 1.38, 1.52], [1, 1.23, 1.52], [1.33, 1.6, 2.0], [1, 2.1, 3.5]]) {
    const R = rt(n0, [[n1, 0, lam / (4 * n1)]], [ns, 0], lam, 0, 's').R;
    close(R, ((n0 * ns - n1 * n1) / (n0 * ns + n1 * n1)) ** 2, 1e-14, `${n0}|${n1}|${ns}`);
  }
  // MgF2 on BK7 at 550 nm, with the dispersive indices.
  const n1 = MATERIALS.mgf2.index(lam)[0], ns = MATERIALS.bk7.index(lam)[0];
  const R = rt(1, [[n1, 0, lam / (4 * n1)]], [ns, 0], lam, 0, 's').R, bare = rt(1, [], [ns, 0], lam, 0, 's').R;
  return `MgF2 on BK7: R = ${(100 * R).toFixed(2)}% (bare glass ${(100 * bare).toFixed(2)}%)`;
});

test('a half-wave layer is absent at its design wavelength', () => {
  for (const n1 of [1.38, 2.3, 1.0]) {
    const R = rt(1, [[n1, 0, 600 / (2 * n1)]], [1.52, 0], 600, 0, 'p').R;
    close(R, rt(1, [], [1.52, 0], 600, 0, 'p').R, 1e-14, `n1 = ${n1}`);
  }
});

test('Bragg mirror: peak R of N quarter-wave pairs, and the width of the stop band', () => {
  const lam0 = 550, nH = 2.35, nL = 1.46, n0 = 1, ns = 1.52;
  const H = [nH, 0, lam0 / (4 * nH)], L = [nL, 0, lam0 / (4 * nL)];
  const lines = [];
  for (let N = 1; N <= 12; N++) {
    const layers = [];
    for (let k = 0; k < N; k++) layers.push(H, L);
    const R = rt(n0, layers, [ns, 0], lam0, 0, 's').R;
    // Each quarter-wave layer turns admittance Y into n^2 / Y: Y = (nH/nL)^(2N) ns.
    const a = n0 * nL ** (2 * N), b = ns * nH ** (2 * N);
    close(R, ((a - b) / (a + b)) ** 2, 1e-13, `N = ${N}`);
    if (N === 3 || N === 6 || N === 12) lines.push(`N=${N}: R=${R.toFixed(6)}`);
  }
  // Stop band: edges at lambda0 / (1 +- dg), dg = (2/pi) arcsin((nH - nL)/(nH + nL)).  Deep in a
  // long stack R is 1; just outside the edges it is not.
  const dg = (2 / Math.PI) * Math.asin((nH - nL) / (nH + nL));
  const layers = [];
  for (let k = 0; k < 60; k++) layers.push(H, L);
  const R = (g) => rt(n0, layers, [ns, 0], lam0 / g, 0, 's').R;
  for (const sgn of [-1, 1]) {
    assert(R(1 + sgn * 0.9 * dg) > 0.9999, `inside the band edge: ${R(1 + sgn * 0.9 * dg)}`);
    // Outside the band, R oscillates (side lobes) but its average is well below 1.
    let mean = 0;
    for (let k = 0; k < 50; k++) mean += R(1 + sgn * (1.05 + 0.002 * k) * dg) / 50;
    assert(mean < 0.6, `outside: mean R ${mean}`);
  }
  lines.push(`stop band ${(lam0 / (1 + dg)).toFixed(0)}-${(lam0 / (1 - dg)).toFixed(0)} nm`);
  return lines.join(', ');
});

test('the field: tangential E and H continuous; energy flux constant through lossless layers', () => {
  const layers = [[2.3, 0, 60], [1.46, 0, 94], [1.0, 0, 150], [1.8, 0, 210]];
  const [nr, ni, d] = arrays(layers);
  for (const pol of ['s', 'p']) for (const th of [0, 35, 62]) {
    const ws = makeWorkspace(4), n0 = 1.5;
    const { R, T } = solve(n0, nr, ni, d, [1.33, 0], 633, n0 * Math.sin(th * deg), pol, ws);
    let z = 0;
    const eps = 1e-7;
    for (let j = 0; j <= 4; j++) {
      const f = field(ws, [z - eps, z + eps]);
      close(f.Er[0], f.Er[1], 1e-6, `E at interface ${j}`); close(f.Ei[0], f.Ei[1], 1e-6);
      close(f.Hr[0], f.Hr[1], 1e-6, `H at interface ${j}`); close(f.Hi[0], f.Hi[1], 1e-6);
      z += d[j] || 0;
    }
    // Poynting flux Re(E H*) / eta0 = 1 - R in front, T everywhere behind (here the substrate is
    // evanescent at 62 deg, so both are 0 there).
    const zs = Float64Array.from({ length: 200 }, (_, i) => -300 + 4 * i);
    const f = field(ws, zs);
    for (let i = 0; i < zs.length; i++) {
      const S = (f.Er[i] * f.Hr[i] + f.Ei[i] * f.Hi[i]) / ws.eta0;
      close(S, T, 1e-12, `flux at z = ${zs[i]} (${pol}, ${th})`);
    }
    close(1 - R, T, 1e-12);
  }
});

test('total internal reflection: the evanescent field decays as exp(-2 k0 sqrt(beta^2 - n2^2) z)', () => {
  const n0 = 1.5168, th = 60, lam = 633, beta = n0 * Math.sin(th * deg);
  for (const pol of ['s', 'p']) {
    const ws = makeWorkspace(0);
    solve(n0, new Float64Array(0), new Float64Array(0), new Float64Array(0), [1, 0], lam, beta, pol, ws);
    const f = field(ws, [10, 110]);
    const kappa = ((2 * Math.PI) / lam) * Math.sqrt(beta * beta - 1);
    close(Math.log(f.E2[0] / f.E2[1]), 2 * kappa * 100, 1e-9, pol);
  }
  return `decay length of |E| at 60 deg, 633 nm in BK7: ${(lam / (2 * Math.PI * Math.sqrt(beta * beta - 1))).toFixed(1)} nm`;
});

test("total internal reflection: the s-p phase difference (Fresnel's rhomb)", () => {
  // tan(Delta/2) = cos(theta) sqrt(sin^2 theta - n^2) / sin^2 theta, n = n2 / n1.
  const n1 = 1.51, n = 1 / n1;
  for (const th of [45, 48.6, 54.6, 70, 85]) {
    const s = rt(n1, [], [1, 0], 600, th, 's'), p = rt(n1, [], [1, 0], 600, th, 'p');
    const S = th * deg, want = 2 * Math.atan((Math.cos(S) * Math.sqrt(Math.sin(S) ** 2 - n * n)) / Math.sin(S) ** 2);
    // phaseDifference uses Born & Wolf's p axes (right-handed with each beam's k), in which
    // r_p = -r_s at normal incidence; the tangential-field r_p of solve() is its negative.
    close(Math.abs(phaseDifference(s, p)) * deg, want, 1e-12, `at ${th}`);
  }
  const at = (th) => Math.abs(phaseDifference(rt(n1, [], [1, 0], 600, th, 's'), rt(n1, [], [1, 0], 600, th, 'p')));
  return `n = 1.51: ${at(54.6).toFixed(2)} deg at 54.6 deg (Fresnel's rhomb: 45 deg per reflection)`;
});

test('frustrated TIR: transmission through an air gap is the quantum barrier formula', () => {
  // T = 1 / (1 + (1/4)(eta1/|eta2| + |eta2|/eta1)^2 sinh^2(kappa d)): for s polarisation eta = q, and
  // this is the textbook T for a particle tunnelling through a square barrier, with
  // k = k0 q1 and kappa = k0 sqrt(beta^2 - n2^2).
  const n1 = 1.5168, lam = 550, th = 45, beta = n1 * Math.sin(th * deg), k0 = (2 * Math.PI) / lam;
  const q1 = Math.sqrt(n1 * n1 - beta * beta), p = Math.sqrt(beta * beta - 1), kappa = k0 * p;
  let worst = 0;
  for (let gap = 0; gap <= 1500; gap += 25) {
    for (const pol of ['s', 'p']) {
      const e1 = pol === 's' ? q1 : (n1 * n1) / q1, e2 = pol === 's' ? p : 1 / p;
      const want = 1 / (1 + 0.25 * (e1 / e2 + e2 / e1) ** 2 * Math.sinh(kappa * gap) ** 2);
      const got = rt(n1, [[1, 0, gap]], [n1, 0], lam, th, pol).T;
      worst = Math.max(worst, Math.abs(got - want) / want);
    }
  }
  assert(worst < 1e-10, `relative error ${worst}`);
  // A wide gap: T ~ 1e-20, still accurate (the scaled matrices).
  const wide = rt(n1, [[1, 0, 6000]], [n1, 0], lam, th, 's').T;
  const want = 1 / (1 + 0.25 * (q1 / p + p / q1) ** 2 * Math.sinh(kappa * 6000) ** 2);
  close(wide / want, 1, 1e-9, 'a 6 um gap');
  return `relative error ${worst.toExponential(1)}; 1/e gap for T: ${(1 / (2 * kappa)).toFixed(0)} nm`;
});

test('reciprocity: T is the same in both directions, even through absorbing layers', () => {
  const layers = [[1.9, 0.1, 80], [0.14, 3.6, 20], [1.4, 0, 300]];
  const rev = [...layers].reverse();
  for (const pol of ['s', 'p']) for (const th of [0, 25, 40]) {
    const n0 = 1.33, ns = 1.6, beta = n0 * Math.sin(th * deg);
    const f = solve(n0, ...arrays(layers), [ns, 0], 520, beta, pol);
    const b = solve(ns, ...arrays(rev), [n0, 0], 520, beta, pol);
    close(f.T, b.T, 1e-13, `${pol} ${th}`);
  }
});

test('the fast path for curves (s and p together) gives the same R and T as solve()', () => {
  const rand = rng(7), out = new Float64Array(4);
  let worst = 0;
  for (let trial = 0; trial < 200; trial++) {
    const L = Math.floor(rand() * 6), n0 = 1 + rand();
    const layers = Array.from({ length: L }, () => (rand() < 0.2 ? [0.1 + rand(), 2 + 3 * rand(), 60 * rand()] : [1 + 1.6 * rand(), 0.05 * rand(), 500 * rand()]));
    const ns = rand() < 0.2 ? [0.2, 3.5] : [1 + rand(), 0];
    const [nr, ni, d] = arrays(layers), beta = n0 * Math.sin(89 * rand() * deg), lam = 400 + 400 * rand();
    rtBoth(n0, nr, ni, d, ns, lam, beta, out);
    const s = solve(n0, nr, ni, d, ns, lam, beta, 's'), p = solve(n0, nr, ni, d, ns, lam, beta, 'p');
    worst = Math.max(worst, Math.abs(out[0] - s.R), Math.abs(out[1] - s.T), Math.abs(out[2] - p.R), Math.abs(out[3] - p.T));
  }
  assert(worst < 1e-13, `max difference ${worst}`);
});

test('sweeping one layer gives the same R and T as solving each stack', () => {
  const layers = [[2.3, 0, 60], [1.33, 0, 300], [0.14, 3.6, 25], [1.46, 0, 94]];
  const ds = [0, 17, 150, 333, 900];
  for (const pol of ['s', 'p']) for (const j of [0, 1, 2, 3]) {
    const [nr, ni, d] = arrays(layers), R = new Float64Array(ds.length), T = new Float64Array(ds.length);
    sweepLayer(1.2, nr, ni, d, [1.5, 0.01], 480, 0.7, pol, j, ds, R, T);
    ds.forEach((dd, i) => {
      const dj = d.slice(); dj[j] = dd;
      const one = solve(1.2, nr, ni, dj, [1.5, 0.01], 480, 0.7, pol);
      close(R[i], one.R, 1e-12, `R, layer ${j}, d ${dd}`); close(T[i], one.T, 1e-12, `T, layer ${j}, d ${dd}`);
    });
  }
});

test('surface plasmon resonance (Kretschmann): the R_p dip sits at the plasmon angle', () => {
  const lam = 633, prism = MATERIALS.bk7.index(lam)[0], [gn, gk] = MATERIALS.gold.index(lam);
  const er = gn * gn - gk * gk, ei = 2 * gn * gk;
  const lines = [];
  for (const nw of [1.333, 1.343]) {
    // k_sp / k0 = sqrt(eps_m eps_d / (eps_m + eps_d)), complex.
    const ed = nw * nw, ar = er * ed, ai = ei * ed, br = er + ed, bi = ei, bb = br * br + bi * bi;
    const xr = (ar * br + ai * bi) / bb, xi = (ai * br - ar * bi) / bb, m = Math.hypot(xr, xi);
    const ksp = Math.sqrt((m + xr) / 2);
    const thSp = Math.asin(ksp / prism) / deg;
    let best = 0, bestR = 2;
    for (let th = 60; th < 85; th += 0.01) { const R = rt(prism, [[gn, gk, 50]], [nw, 0], lam, th, 'p').R; if (R < bestR) { bestR = R; best = th; } }
    // The prism, coupling through the 50 nm film, pulls the dip about a degree below the plasmon
    // angle of a bare gold-water interface.  (An independent Python calculation puts the dips at
    // 74.81 and 76.53 deg.)
    assert(Math.abs(best - thSp) < 1.2, `dip ${best} vs plasmon ${thSp}`);
    assert(bestR < 0.15, `a deep dip: R_min = ${bestR}`);
    lines.push(`water ${nw}: dip ${best.toFixed(2)} deg (plasmon ${thSp.toFixed(2)}), R_min ${bestR.toFixed(3)}`);
  }
  return lines.join('; ');
});

test('agrees with an independent calculation (interface and propagation matrices, in Python)', () => {
  // Reference values from 2 x 2 amplitude matrices (r_ij, t_ij at each interface, phase factors
  // between), the formulation of S. J. Byrnes' tmm package, written separately in numpy.
  const layers = [[2.3, 0, 60], [1.33, 0, 300], [0.14, 3.6, 25], [1.46, 0, 94]];
  const s = solve(1.2, ...arrays(layers), [1.5, 0.01], 480, 0.7, 's'), p = solve(1.2, ...arrays(layers), [1.5, 0.01], 480, 0.7, 'p');
  close(s.R, 0.9543676514697835, 1e-13, 'R_s'); close(s.T, 0.03132042043462913, 1e-13, 'T_s');
  close(p.R, 0.8842407532699081, 1e-13, 'R_p'); close(p.T, 0.08459702073140526, 1e-13, 'T_p');
  close(rt(1, [[1.38, 0, 550 / 4 / 1.38]], [1.52, 0], 550, 0, 's').R, 0.012600790214630288, 1e-15, 'AR');
});

test('materials: Sellmeier and Lorentz-Drude values against reference data', () => {
  close(MATERIALS.bk7.index(587.56)[0], 1.5168, 2e-5, 'BK7 n_d (Schott 1.51680)');
  close(MATERIALS.silica.index(587.56)[0], 1.4585, 1e-4, 'fused silica n_d (1.4585)');
  // Water, 20 C, 589.3 nm: 1.33299 relative to air, i.e. 1.33335 absolute.
  close(MATERIALS.water.index(589.29)[0] / 1.00027, 1.33299, 1e-4, 'water n_D');
  close(MATERIALS.mgf2.index(589.3)[0], 1.3777, 2e-4, 'MgF2 n_o');
  close(MATERIALS.tio2.index(589.3)[0], 2.613, 2e-3, 'rutile n_o');
  // Metals: Johnson & Christy (1972) for orientation; the Lorentz-Drude fits are within ~20%
  // in Re(eps) and less good in Im(eps).
  const eps = (m, nm) => { const [n, k] = MATERIALS[m].index(nm); return [n * n - k * k, 2 * n * k]; };
  const ag = eps('silver', 633), au = eps('gold', 633), au5 = eps('gold', 500), al = eps('aluminium', 550);
  assert(ag[0] < -13 && ag[0] > -20 && ag[1] > 0.3 && ag[1] < 1.5, `silver 633: ${ag}`);
  assert(au[0] < -9 && au[0] > -13 && au[1] > 0.8 && au[1] < 2.2, `gold 633: ${au}`);
  assert(au5[0] < -2 && au5[0] > -4 && au5[1] > 2 && au5[1] < 4, `gold 500: ${au5}`);
  assert(al[0] < -35 && al[0] > -50 && al[1] > 8 && al[1] < 16, `aluminium 550: ${al}`);
  const R = (m, nm) => rt(1, [], MATERIALS[m].index(nm), nm, 0, 's').R;
  assert(R('silver', 550) > 0.94 && R('silver', 320) < 0.2, 'silver: bright in the visible, dark at its 320 nm plasma edge');
  assert(R('gold', 450) < 0.45 && R('gold', 700) > 0.9, 'gold: dull in the blue, bright in the red');
  return `silver eps(633) = ${ag[0].toFixed(1)} + ${ag[1].toFixed(2)}i, gold ${au[0].toFixed(1)} + ${au[1].toFixed(2)}i`;
});

test('colour: the matching functions, the D65 white point, and white light staying white', () => {
  // CIE 1931 table values; the fit is within a few per cent.
  for (const [nm, x, y, z] of [[450, 0.3362, 0.038, 1.7721], [500, 0.0049, 0.323, 0.272], [555, 0.5121, 1.0, 0.0057], [600, 1.0622, 0.631, 0.0008], [650, 0.2835, 0.107, 0]]) {
    const c = cmf(nm);
    close(c[0], x, 0.04 * 1.06 + 0.02 * x, `xbar(${nm})`); close(c[1], y, 0.03, `ybar(${nm})`); close(c[2], z, 0.05 * 1.77, `zbar(${nm})`);
  }
  const nms = wavelengths(380, 780, 1), ones = new Float64Array(nms.length).fill(1);
  const col = colorimeter(nms, 'd65');
  const [x, y] = chromaticity(col.xyz(ones));
  assert(Math.hypot(x - 0.3127, y - 0.3290) < 0.003, `D65 white point with the fitted CMFs: (${x.toFixed(4)}, ${y.toFixed(4)})`);
  for (const ill of ['d65', 'e']) {
    const c = colorimeter(nms, ill), rgb = toDisplay(c.linear(c.xyz(ones)));
    for (const v of rgb) close(v, 1, 1e-9, `a perfect reflector is white under ${ill}`);
  }
  // Light through a stack that reflects nothing (glass on index-matched glass) is the light itself.
  const T = nms.map((nm) => rt(1.5, [[1.5, 0, 300]], [1.5, 0], nm, 0, 's').T);
  const [tx, ty] = chromaticity(col.xyz(T));
  assert(Math.hypot(tx - 0.3127, ty - 0.329) < 0.003, `transmitted white: (${tx}, ${ty})`);
  return `D65 white point (${x.toFixed(4)}, ${y.toFixed(4)}) against (0.3127, 0.3290)`;
});

test('colour: gold is yellow, silver is neutral, a MgF2 coating reflects purple', () => {
  const nms = wavelengths(380, 780, 2), col = colorimeter(nms, 'd65');
  const rgbOf = (S) => toDisplay(col.linear(col.xyz(S)).map((v) => v * 3));
  const R = (n0, layers, sub) => nms.map((nm) => { const m = typeof sub === 'string' ? MATERIALS[sub].index(nm) : sub; return 0.5 * (rt(n0, layers(nm), m, nm, 0, 's').R + rt(n0, layers(nm), m, nm, 0, 'p').R); });
  const gold = toDisplay(col.linear(col.xyz(R(1, () => [], 'gold'))));
  assert(gold[0] > gold[1] && gold[1] > gold[2] + 0.15, `gold ${gold}`);
  const silver = toDisplay(col.linear(col.xyz(R(1, () => [], 'silver'))));
  assert(Math.max(...silver) - Math.min(...silver) < 0.06, `silver ${silver}`);
  const n1 = MATERIALS.mgf2.index(550)[0];
  const coated = rgbOf(R(1, (nm) => [[MATERIALS.mgf2.index(nm)[0], 0, 550 / (4 * n1)]], 'bk7'));
  assert(coated[0] > coated[1] && coated[2] > coated[1], `the coating's reflection: ${coated}`);
  return `gold (${gold.map((v) => v.toFixed(2))}), silver (${silver.map((v) => v.toFixed(2))}), coating (${coated.map((v) => v.toFixed(2))})`;
});

test('the design notation: (HL)^N H, multipliers, merging neighbours, errors', () => {
  const d = parseDesign('(HL)^N H');
  assert(d.names.length === 1 && d.names[0] === 'N');
  assert(expandDesign(d.items, { N: 3 }).map((l) => l.m).join('') === 'HLHLHLH');
  const fp = expandDesign(parseDesign('(HL)^2 2H (LH)^2').items);
  assert(fp.map((l) => l.m + l.q).join(' ') === 'H1 L1 H1 L1 H2 L1 H1 L1 H1', JSON.stringify(fp));
  assert(expandDesign(parseDesign('L 0.5l H').items).map((l) => l.m + l.q).join(' ') === 'L1.5 H1');
  for (const bad of ['(HL', 'HL)', 'X', '2(HL)', '(HL)^', '']) {
    let threw = false;
    try { parseDesign(bad); } catch { threw = true; }
    assert(threw, `"${bad}" should be an error`);
  }
});

test('the draining film: thickness grows as the square root of depth, black on top', () => {
  close(drainingThickness(0.25, 1000), 500, 1e-12);
  close(drainingThickness(1, 1000), 1000, 1e-12);
  close(drainingThickness(0, 1000), 10, 1e-12, 'black film');
  close(drainingThickness(0.0004, 1000), 10, 1e-12, 'below the critical thickness');
});

test('the field: |E|^2 is normalised to the incident wave (1 in front of a non-reflecting stack)', () => {
  for (const pol of ['s', 'p']) {
    const ws = makeWorkspace(1);
    // Index-matched: no reflection, so |E|^2 = |E_inc|^2 everywhere.
    solve(1.5, Float64Array.of(1.5), Float64Array.of(0), Float64Array.of(200), [1.5, 0], 500, 1.5 * Math.sin(40 * deg), pol, ws);
    const f = field(ws, [-100, 50, 300]);
    for (const v of f.E2) close(v / incidentE2(ws), 1, 1e-12, pol);
  }
});
