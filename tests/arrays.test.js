import { test, assert, close } from './harness.js';
import {
  K, patterns, angles, analysePattern, lineAxis, directivity, radiatedPower, elementFactor, arrayFactor,
  taper, chebyshev, steerPhases, focusPhases, nearField, fieldAt,
} from '../arrays/antenna.js';

const DEG = Math.PI / 180;
const ISO = { kind: 'iso', angle: 0 };
const line = (n, d, alpha = 0, amps = null) => Array.from({ length: n }, (_, i) => ({ x: (i - (n - 1) / 2) * d, y: 0, amp: amps ? amps[i] : 1, phase: i * alpha }));
const TH = angles(3600);

// Gauss-Legendre nodes and weights on [-1, 1] (Newton's method on P_n).
function gaussLegendre(n) {
  const x = new Float64Array(n), w = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let z = Math.cos((Math.PI * (i + 0.75)) / (n + 0.5)), dp = 0;
    for (let it = 0; it < 100; it++) {
      let p0 = 1, p1 = z;
      for (let k = 2; k <= n; k++) { const p2 = ((2 * k - 1) * z * p1 - (k - 1) * p0) / k; p0 = p1; p1 = p2; }
      dp = (n * (z * p1 - p0)) / (z * z - 1);
      const dz = p1 / dp; z -= dz;
      if (Math.abs(dz) < 1e-16) break;
    }
    x[i] = z; w[i] = 2 / ((1 - z * z) * dp * dp);
  }
  return [x, w];
}

// A tiny deterministic random generator, so the tests are repeatable.
function rng(seed) { return () => ((seed = (seed * 16807) % 2147483647) / 2147483647); }

// ------------------------------------------------------------------ arrays

test('the array factor of N equal elements is sin(N psi/2) / sin(psi/2), psi = kd sin(theta) - alpha', () => {
  let worst = 0;
  for (const [n, d, alpha] of [[2, 0.5, 0], [5, 0.3, 1], [8, 0.5, 0.7], [12, 1.3, -2], [16, 0.25, Math.PI]]) {
    const { af } = patterns(line(n, d, alpha), ISO, TH);
    TH.forEach((t, i) => {
      const psi = K * d * Math.sin(t) - alpha, s = Math.sin(psi / 2);
      const exact = Math.abs(s) < 1e-9 ? n : Math.abs(Math.sin((n * psi) / 2) / s);
      worst = Math.max(worst, Math.abs(Math.sqrt(af[i]) - exact) / n);
    });
  }
  assert(worst < 1e-12, `largest error ${worst}`);
  return `largest error ${worst.toExponential(1)} of N`;
});

test('a uniform line: the half-power width and first sidelobe agree with the closed form', () => {
  for (const n of [4, 8, 16]) {
    const P = patterns(line(n, 0.5), ISO, TH).total, a = analysePattern(P, { mirror: lineAxis(line(n, 0.5)) });
    // |AF/N|^2 = 1/2 at psi_h: bisection; theta = asin(psi / k d).
    const g = (psi) => (Math.sin((n * psi) / 2) / (n * Math.sin(psi / 2))) ** 2 - 0.5;
    let lo = 1e-9, hi = (2 * Math.PI) / n;
    for (let k = 0; k < 80; k++) { const m = (lo + hi) / 2; if (g(m) > 0) lo = m; else hi = m; }
    const hpbw = 2 * Math.asin(lo / Math.PI);
    close(a.hpbw / DEG, hpbw / DEG, 0.02, `N=${n} beamwidth (deg)`);
    // The first sidelobe: the largest |AF/N|^2 beyond the first null.
    let sl = 0;
    for (let psi = (2 * Math.PI) / n; psi <= (4 * Math.PI) / n; psi += 1e-5) sl = Math.max(sl, g(psi) + 0.5);
    close(a.sll, 10 * Math.log10(sl), 0.02, `N=${n} sidelobe (dB)`);
    close(a.beam, 0, 1e-9, 'beam straight up');
  }
});

test('steering by a progressive phase points the beam at theta0', () => {
  for (const t0 of [-60, -20, 0, 15, 45]) {
    const els = line(10, 0.5), ph = steerPhases(els, t0 * DEG);
    els.forEach((e, i) => { e.phase = ph[i]; });
    // The progressive phase between neighbours is k d sin(theta0).
    close(Math.cos(els[1].phase - els[0].phase), Math.cos(K * 0.5 * Math.sin(t0 * DEG)), 1e-12, 'alpha');
    const a = analysePattern(patterns(els, ISO, TH).total, { prefer: t0 * DEG, mirror: lineAxis(els) });
    close(a.beam / DEG, t0, 0.01, `beam for theta0 = ${t0}`);
  }
});

test('grating lobes appear at sin(theta) = sin(theta0) + m lambda/d once d > lambda / (1 + |sin theta0|)', () => {
  const t0 = 30 * DEG, threshold = 1 / (1 + Math.sin(t0));
  const run = (d) => {
    const els = line(16, d), ph = steerPhases(els, t0);
    els.forEach((e, i) => { e.phase = ph[i]; });
    return analysePattern(patterns(els, ISO, TH).total, { prefer: t0, mirror: lineAxis(els) });
  };
  const below = run(threshold * 0.95), above = run(0.8);
  assert(below.sll < -10, `d = ${(threshold * 0.95).toFixed(3)}: no grating lobe (highest sidelobe ${below.sll.toFixed(2)} dB)`);
  close(above.sll, 0, 0.01, 'd = 0.8: a grating lobe as strong as the beam');
  const expected = Math.asin(Math.sin(t0) - 1 / 0.8);
  // The lobe or its mirror image across the line.
  const got = above.sllAngle, mirror = Math.PI - got;
  const err = Math.min(Math.abs(got - expected), Math.abs(((mirror + Math.PI) % (2 * Math.PI)) - Math.PI - expected));
  assert(err < 0.15 * DEG, `grating lobe at ${(got / DEG).toFixed(2)} deg, expected ${(expected / DEG).toFixed(2)}`);
  return `threshold d = ${threshold.toFixed(4)} lambda; at d = 0.8 the lobe is at ${(expected / DEG).toFixed(2)} deg`;
});

test('a short dipole: element pattern sin^2 of the angle to its axis, and B_z = curl A exactly', () => {
  for (const b of [0, 30, 90]) {
    const elem = { kind: 'dipole', angle: b * DEG }, { total } = patterns([{ x: 0, y: 0, amp: 1, phase: 0 }], elem, TH);
    let worst = 0;
    TH.forEach((t, i) => {
      // Angle between r^ = (sin t, cos t) and p^ = (cos b, sin b).
      const c = Math.sin(t) * Math.cos(b * DEG) + Math.cos(t) * Math.sin(b * DEG);
      worst = Math.max(worst, Math.abs(total[i] - (1 - c * c)));
    });
    assert(worst < 1e-12, `beta ${b}: ${worst}`);
  }
  // B = curl(p^ g(r)), g = exp(ikr)/kr, by central differences, against the closed form (times ik).
  const elem = { kind: 'dipole', angle: 0.4 }, px = Math.cos(0.4), py = Math.sin(0.4), e = [{ x: 0.1, y: -0.2, amp: 1, phase: 0 }];
  const g = (x, y) => { const r = Math.hypot(x - 0.1, y + 0.2); return [Math.cos(K * r) / (K * r), Math.sin(K * r) / (K * r)]; };
  const hh = 1e-5;
  for (const [x, y] of [[0.3, 0.1], [1.2, -0.7], [-0.4, 2.5], [5, 5]]) {
    const gx = [0, 1].map((c) => (g(x + hh, y)[c] - g(x - hh, y)[c]) / (2 * hh));
    const gy = [0, 1].map((c) => (g(x, y + hh)[c] - g(x, y - hh)[c]) / (2 * hh));
    const bz = [px * 0 + (py * gx[0] - px * gy[0]), py * gx[1] - px * gy[1]];       // curl_z (p^ g)
    const [fr, fi] = fieldAt(e, elem, x, y);
    // ik (fr + i fi) = -K fi + i K fr
    close(bz[0], -K * fi, 1e-6 * Math.hypot(bz[0], bz[1]) + 1e-9, 'Re B_z');
    close(bz[1], K * fr, 1e-6 * Math.hypot(bz[0], bz[1]) + 1e-9, 'Im B_z');
  }
});

test('directivity in closed form agrees with integrating the pattern over the sphere', () => {
  const R = rng(7);
  const els = Array.from({ length: 5 }, () => ({ x: 3 * R() - 1.5, y: 3 * R() - 1.5, amp: 0.3 + R(), phase: 6 * R() }));
  for (const elem of [ISO, { kind: 'dipole', angle: 0.5 }]) {
    // Brute force: Gauss-Legendre in cos(polar angle), trapezoid in azimuth; r^ in 3D.
    const nm = 120, nf = 240, px = Math.cos(elem.angle), py = Math.sin(elem.angle), [nodes, wts] = gaussLegendre(nm);
    let tot = 0;
    for (let a = 0; a < nm; a++) {
      const mu = nodes[a], st = Math.sqrt(1 - mu * mu);
      for (let b = 0; b < nf; b++) {
        const f = (2 * Math.PI * b) / nf, rx = st * Math.cos(f), ry = st * Math.sin(f);
        let re = 0, im = 0;
        for (const e of els) { const ph = e.phase - K * (rx * e.x + ry * e.y); re += e.amp * Math.cos(ph); im += e.amp * Math.sin(ph); }
        const ef = elem.kind === 'dipole' ? 1 - (rx * px + ry * py) ** 2 : 1;
        tot += wts[a] * (re * re + im * im) * ef;
      }
    }
    const brute = (tot * ((2 * Math.PI) / nf)) / (4 * Math.PI);
    const exact = radiatedPower(els, elem);
    close(brute / exact, 1, 1e-12, `${elem.kind}: power`);
  }
  close(directivity([{ x: 0, y: 0, amp: 1, phase: 0 }], { kind: 'dipole', angle: 0 }, 0), 1.5, 1e-12, 'a short dipole: D = 1.5');
  close(directivity([{ x: 0, y: 0, amp: 1, phase: 0 }], ISO, 0.3), 1, 1e-12, 'an isotropic element: D = 1');
  for (const n of [2, 7, 16]) close(directivity(line(n, 0.5), ISO, 0), n, 1e-9, `N = ${n} at lambda/2, broadside: D = N`);
});

test('tapers: Chebyshev sidelobes all at the design level, binomial has none, Hann and Taylor lower them', () => {
  const n = 16, uni = analysePattern(patterns(line(n, 0.5), ISO, TH).total, { mirror: 90 * DEG });
  const get = (kind) => {
    const els = line(n, 0.5), w = taper(els, kind, 30);
    els.forEach((e, i) => { e.amp = w[i]; });
    return { els, a: analysePattern(patterns(els, ISO, TH).total, { mirror: lineAxis(els) }) };
  };
  // Chebyshev: every local maximum outside the main lobe is at -30 dB.
  const { els } = get('chebyshev'), P = patterns(els, ISO, TH).total, pmax = Math.max(...P);
  const lobes = [];
  for (let i = 1; i < P.length - 1; i++) if (P[i] >= P[i - 1] && P[i] > P[i + 1] && P[i] < 0.5 * pmax) lobes.push(10 * Math.log10(P[i] / pmax));
  assert(lobes.length >= 20 && lobes.every((v) => Math.abs(v + 30) < 0.05), `Chebyshev sidelobes ${lobes.map((v) => v.toFixed(2)).join(' ')}`);
  const bin = get('binomial'), hann = get('hann'), tay = get('taylor');
  assert(bin.a.sll === null, `binomial: no sidelobes (got ${bin.a.sll})`);
  assert(hann.a.sll < -28 && hann.a.hpbw > 1.4 * uni.hpbw, `Hann: ${hann.a.sll.toFixed(1)} dB, width ${(hann.a.hpbw / DEG).toFixed(2)} vs ${(uni.hpbw / DEG).toFixed(2)}`);
  assert(Math.abs(tay.a.sll + 30) < 1.5 && tay.a.hpbw > uni.hpbw, `Taylor: ${tay.a.sll.toFixed(2)} dB`);
  assert(bin.a.hpbw > hann.a.hpbw, 'the binomial beam is the widest');
  // The weights are symmetric and peak in the middle.
  const w = chebyshev(9, 25);
  for (let i = 0; i < 9; i++) close(w[i], w[8 - i], 1e-12, 'symmetric');
  return `sidelobes: uniform ${uni.sll.toFixed(2)}, Hann ${hann.a.sll.toFixed(2)}, Taylor ${tay.a.sll.toFixed(2)}, Chebyshev -30.00 dB; widths ${[uni.hpbw, tay.a.hpbw, hann.a.hpbw, bin.a.hpbw].map((v) => (v / DEG).toFixed(1)).join(', ')} deg`;
});

test('the near field on the grid matches the exact sum of outgoing waves', () => {
  const R = rng(3);
  const els = Array.from({ length: 6 }, () => ({ x: 4 * R() - 2, y: 4 * R() - 2, amp: 0.5 + R(), phase: 6 * R() }));
  const g = 96, grid = { g, h: 8 / g, x0: -4, y0: 4 };
  const re = new Float64Array(g * g), im = new Float64Array(g * g), notes = [];
  for (const elem of [ISO, { kind: 'dipole', angle: 1 }]) {
    nearField(els, elem, grid, re, im);
    let worst = 0;
    for (let j = 0; j < g; j++) for (let i = 0; i < g; i++) {
      const x = -4 + (i + 0.5) * grid.h, y = 4 - (j + 0.5) * grid.h;
      if (els.some((e) => Math.hypot(x - e.x, y - e.y) < 0.3)) continue;
      const [a, b] = fieldAt(els, elem, x, y), o = j * g + i;
      // Relative to the field's scale there: the sum of the magnitudes of the waves.
      const scale = els.reduce((s, e) => s + e.amp / (K * Math.hypot(x - e.x, y - e.y)), 0);
      worst = Math.max(worst, Math.hypot(re[o] - a, im[o] - b) / scale);
    }
    assert(worst < 1e-3, `${elem.kind}: ${worst}`);
    notes.push(`${elem.kind} ${worst.toExponential(1)}`);
  }
  return `largest error relative to the local field scale: ${notes.join(', ')}`;
});

test('far away, the field is the element pattern times the array factor times exp(ikr)/kr', () => {
  const els = line(5, 0.6, 0.8), elem = { kind: 'dipole', angle: 0.3 }, r = 4000;
  for (const t of [0.2, 1.1, -2.5]) {
    const [a, b] = fieldAt(els, elem, r * Math.sin(t), r * Math.cos(t));
    const [fr, fi] = arrayFactor(els, t), e = elementFactor(elem, t), kr = K * r;
    const er = (e * (fr * Math.cos(kr) - fi * Math.sin(kr))) / kr, ei = (e * (fr * Math.sin(kr) + fi * Math.cos(kr))) / kr;
    // Relative to the largest the far field could be there (all waves in step).
    const scale = Math.abs(e) * els.reduce((s, x) => s + x.amp, 0) / kr;
    close(Math.hypot(a - er, b - ei) / scale, 0, 2e-3, `theta ${t}`);
  }
});

test('focusing: phases phi_n = -k|f - r_n| bring every wave to the focus in step', () => {
  const els = line(16, 0.5).map((e) => ({ ...e, y: -1 }));
  const f = [0.5, 3], ph = focusPhases(els, ...f);
  els.forEach((e, i) => { e.phase = ph[i]; });
  const [a, b] = fieldAt(els, ISO, ...f);
  const inStep = els.reduce((s, e) => s + 1 / (K * Math.hypot(f[0] - e.x, f[1] - e.y)), 0);
  close(Math.hypot(a, b), inStep, 1e-12, '|psi(f)| = sum 1/kr_n');
  // The aperture subtends sin(a1) + sin(a2) = 1.36 at the focus: the first zero across the
  // spot is near lambda / 1.36 = 0.73 lambda.
  const side = [0.5, -0.5].map((dx) => Math.hypot(...fieldAt(els, ISO, f[0] + dx, f[1])) / Math.hypot(a, b));
  assert(side.every((v) => v < 0.4), `half a wavelength to either side: ${side.map((v) => v.toFixed(3))} of the focus`);
  return `half a wavelength to either side the field is ${side.map((v) => v.toFixed(2)).join(' and ')} of the focus's`;
});
