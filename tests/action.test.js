import { test, assert, close } from './harness.js';
import { Path, action, quadrature, knotQuadrature, truePaths, closedOrbits, truthAt, knotGradient, knotDerivatives, knotTimeDerivatives, stationaryKnots, freeKnots, energy, hamiltonianGrid } from '../action/physics.js';
import { SYSTEMS, typedSystem, parseTyped, cycloid, oscillatorOrbit } from '../action/systems.js';

const sys = (id, over = {}) => {
  const d = SYSTEMS.find((s) => s.id === id);
  const params = Object.fromEntries(Object.entries(d.params).map(([k, v]) => [k, v.value]));
  Object.assign(params, over);
  return { d, params, L: d.make(params) };
};
const straight = (q0, q1, n) => Array.from({ length: n }, (_, i) => q0 + ((q1 - q0) * i) / (n - 1));
// Knot times from s0 to s1, unevenly spaced (the same every run): a stand-in for knots dragged sideways.
const uneven = (s0, s1, n, seed = 1) => {
  let x = seed;
  const r = () => { x = (x * 16807) % 2147483647; return x / 2147483647; };
  const w = Array.from({ length: n - 1 }, () => 0.4 + r()), sum = w.reduce((a, b) => a + b, 0);
  const s = [s0];
  for (const wi of w) s.push(s[s.length - 1] + ((s1 - s0) * wi) / sum);
  s[n - 1] = s1;
  return s;
};

test('the spline passes through its knots, evenly spaced or not', () => {
  const k = [0, 1, -1, 2, 0.5];
  const p = new Path(0, 4, k);
  const { q } = p.sample([0, 1, 2, 3, 4]);
  for (let i = 0; i < 5; i++) close(q[i], k[i], 1e-12);
  const s = [0, 0.3, 1.9, 2.2, 4], pu = new Path(0, 4, k, 'spline', { s });
  const qu = pu.sample(s).q;
  for (let i = 0; i < 5; i++) close(qu[i], k[i], 1e-12, `knot ${i}`);
});

test('the spline draws a parabola exactly through unevenly spaced knots (not-a-knot ends)', () => {
  const par = (t) => 5 * t * (2 - t) + 0.3 * t;
  for (const n of [3, 4, 7]) {
    const s = uneven(0, 2, n, n), p = new Path(0, 2, s.map(par), 'spline', { s });
    const ts = Array.from({ length: 41 }, (_, i) => i / 20), smp = p.sample(ts);
    for (let i = 0; i < ts.length; i++) {
      close(smp.q[i], par(ts[i]), 1e-12, `n=${n}, t=${ts[i]}`);
      close(smp.v[i], 10 - 10 * ts[i] + 0.3, 1e-10, `slope, n=${n}`);
    }
  }
});

test('a periodic spline closes smoothly: same place, slope and curvature at both ends', () => {
  const s = [0, 0.7, 1.1, 2.6, 3], p = new Path(0, 3, [0.5, 2, -1, 1, 99], 'spline', { s, periodic: true });
  const e = p.sample([0, 3]);
  close(e.q[0], e.q[1], 1e-12, 'place'); close(e.v[0], e.v[1], 1e-12, 'slope'); close(e.a[0], e.a[1], 1e-12, 'curvature');
  close(p.q[4], 0.5, 0, 'the last knot is the first');
});

test('free particle: the straight line has S = m dx^2 / 2T, however the knots are spaced, and is the true path', () => {
  const { d, params, L } = sys('free');
  for (const s of [straight(0, 2, 5), uneven(0, 2, 5)]) {
    for (const mode of ['spline', 'segments']) {
      const S = action(L, new Path(0, 2, s.map((t) => 2 * t), mode, { s }), knotQuadrature(s)).S;
      close(S, d.exact(params, 0, 0, 2, 4), 1e-10, mode);
    }
  }
  const tp = truePaths(L, 0, 0, 2, 4, { vmax: d.vmax });
  assert(tp.length === 1 && tp[0].index === 0, `${tp.length} paths`);
  close(tp[0].S, 4, 1e-6);
});

test('straight segments at uneven times: the action is the sum over segments, exactly', () => {
  // L = v^2/2 - g x: each segment gives dx^2/2dt - g dt (x_a + x_b)/2.
  const { L } = sys('gravity');
  const s = uneven(0, 2, 7, 3), q = s.map((t) => 5 * t * (2 - t) + Math.sin(3 * t));
  let exact = 0;
  for (let i = 0; i < 6; i++) { const dt = s[i + 1] - s[i], dx = q[i + 1] - q[i]; exact += (dx * dx) / (2 * dt) - (10 * dt * (q[i] + q[i + 1])) / 2; }
  close(action(L, new Path(0, 2, q, 'segments', { s }), knotQuadrature(s, 120)).S, exact, 1e-10);
});

test('knots on the true path at uneven times: the action converges to the true one', () => {
  // The oscillator from x = 1 to 0.5 in T = 2, S = (m w / 2 sin wT)((x0^2 + x1^2) cos wT - 2 x0 x1).
  const { d, params, L } = sys('harmonic'), T = 2, exact = d.exact(params, 0, 1, T, 0.5);
  const x = (t) => (0.5 * Math.sin(t) + Math.sin(T - t)) / Math.sin(T);
  const errors = { spline: [], segments: [] };
  for (const n of [5, 9, 17, 33]) {
    const s = uneven(0, T, n, n);
    for (const mode of ['spline', 'segments']) errors[mode].push(Math.abs(action(L, new Path(0, T, s.map(x), mode, { s }), knotQuadrature(s, 1200)).S - exact));
  }
  // Fourth order for the spline, second for straight segments.
  for (const [mode, e] of Object.entries(errors)) {
    for (let i = 1; i < e.length; i++) assert(e[i] < e[i - 1] / (mode === 'spline' ? 8 : 3), `${mode}: errors ${e.map((v) => v.toExponential(1))}`);
  }
  assert(errors.spline[3] < 1e-6 && errors.segments[3] < 1e-3, `errors ${errors.spline[3]}, ${errors.segments[3]}`);
  // The brachistochrone's singular start: a fine spline through the cycloid gives back its time.
  const b = sys('brachistochrone'), c = cycloid(1, Math.PI, 2), sb = uneven(0, Math.PI, 41, 5);
  close(action(b.L, new Path(0, Math.PI, truthAt(c, sb), 'spline', { s: sb }), knotQuadrature(sb, 4000, true)).S, Math.PI, 0.01, 'cycloid');
  return `|S - S_true| with 33 knots: spline ${errors.spline[3].toExponential(1)}, segments ${errors.segments[3].toExponential(1)}`;
});

test('the knot gradient is the derivative of the action, up-down and in time', () => {
  const { L } = sys('pendulum');
  const s = uneven(0, 8, 8, 2), q = s.map((t) => Math.sin(t) + 0.1 * t);
  for (const mode of ['spline', 'segments']) {
    const p = new Path(0, 8, q, mode, { s }), quad = knotQuadrature(s), g = knotGradient(L, p, quad);
    const { g: gs } = knotTimeDerivatives(L, p);
    for (let k = 1; k < 7; k++) {
      const e = 1e-5, up = Float64Array.from(q), dn = Float64Array.from(q);
      up[k] += e; dn[k] -= e;
      close(g[k], (action(L, p.withKnots(up), quad).S - action(L, p.withKnots(dn), quad).S) / (2 * e), 1e-6 * (1 + Math.abs(g[k])), `${mode} dS/dq_${k}`);
      const su = Float64Array.from(s), sd = Float64Array.from(s);
      su[k] += e; sd[k] -= e;
      const fd = (action(L, p.withTimes(su), knotQuadrature(su)).S - action(L, p.withTimes(sd), knotQuadrature(sd)).S) / (2 * e);
      close(gs[k], fd, 1e-5 * (1 + Math.abs(fd)), `${mode} dS/ds_${k}`);
    }
  }
});

test('in time, the slope of the action at a knot is the jump in energy there (straight segments)', () => {
  const { L } = sys('gravity');
  const s = uneven(0, 2, 6, 4), q = s.map((t) => 5 * t * (2 - t) + Math.cos(2 * t));
  const { g } = knotTimeDerivatives(L, new Path(0, 2, q, 'segments', { s }));
  // E on each segment: v^2/2 + g x averaged over the segment.
  const E = Array.from({ length: 5 }, (_, i) => ((q[i + 1] - q[i]) / (s[i + 1] - s[i])) ** 2 / 2 + (10 * (q[i] + q[i + 1])) / 2);
  for (let k = 1; k < 5; k++) close(g[k], E[k] - E[k - 1], 1e-6 * (1 + Math.abs(g[k])), `knot ${k}`);
});

test('throw and catch: the parabola, S = -m g^2 T^3 / 24, a minimum', () => {
  const { d, params, L } = sys('gravity');
  const tp = truePaths(L, 0, 0, 2, 0, { vmax: d.vmax });
  assert(tp.length === 1, `${tp.length} paths`);
  close(tp[0].S, d.exact(params, 0, 0, 2, 0), 1e-8);
  close(tp[0].S, -100 * 8 / 24, 1e-8);
  assert(tp[0].index === 0, 'minimum');
});

test('harmonic oscillator: S from the formula; a minimum for T < pi, a saddle beyond', () => {
  const { d, params, L } = sys('harmonic');
  for (const [T, index] of [[2, 0], [4, 1], [7, 2]]) {
    const tp = truePaths(L, 0, 1, T, 0.5, { vmax: d.vmax });
    assert(tp.length === 1, `T=${T}: ${tp.length} paths`);
    close(tp[0].S, d.exact(params, 0, 1, T, 0.5), 1e-8, `T=${T}`);
    assert(tp[0].index === index, `T=${T}: index ${tp[0].index}, expected ${index}`);
  }
  // Beyond half a period, adding half a sine wave lowers the action below the true path's.
  const T = 4, tp = truePaths(L, 0, 1, T, 0.5, { vmax: d.vmax })[0], quad = quadrature(0, T, 800);
  const n = 41, knots = Array.from({ length: n }, (_, i) => {
    const t = (T * i) / (n - 1), j = Math.round((tp.q.length - 1) * (t / T));
    return tp.q[j] + 3 * Math.sin((Math.PI * t) / T);
  });
  const S = action(L, new Path(0, T, knots), quad).S;
  assert(S < tp.S, `wiggled path ${S} vs true ${tp.S}`);
});

// What the page does to start an experiment: knots evenly spaced in time on the true path,
// nudged to where the action of the path through them is stationary.
function start(id, { mode = 'spline', T, knots } = {}) {
  const s = sys(id), d = s.d, s1 = d.s0 + (T ?? d.s1 - d.s0), n = knots ?? d.knots;
  const tp = d.truePaths ? d.truePaths(s.params, d.s0, d.q0, s1, d.q1) : truePaths(s.L, d.s0, d.q0, s1, d.q1, { vmax: d.vmax, max: 6 });
  const times = Float64Array.from({ length: n }, (_, i) => d.s0 + ((s1 - d.s0) * i) / (n - 1));
  const q = truthAt(tp[0], times);
  q[0] = d.q0; q[n - 1] = d.q1;
  const qopt = { singularStart: !!d.singularStart };
  const r = stationaryKnots(s.L, new Path(d.s0, s1, q, mode, { s: times }), qopt);
  return { ...s, tp, path: r.path, index: r.index, qopt, quad: knotQuadrature(times, 600, qopt.singularStart) };
}

test('every system starts on its true path: dS/dq = 0 at the knots, and a minimum stays one', () => {
  const notes = [];
  for (const [id, opts] of [['free'], ['gravity'], ['gravity', { mode: 'segments', knots: 4 }], ['harmonic'], ['harmonic', { T: 4 }],
    ['pendulum'], ['twin'], ['mirage'], ['refraction'], ['brachistochrone']]) {
    const st = start(id, opts), { L, path, quad, d } = st, n = path.q.length, span = d.qrange[1] - d.qrange[0];
    const S0 = action(L, path, quad).S, g = knotGradient(L, path, quad);
    const { H } = knotDerivatives(L, path, quad);
    const stiff = Math.max(...H.map((r, i) => r[i]));
    // The step to stationary is far below a pixel.
    for (let k = 1; k < n - 1; k++) assert(Math.abs(g[k]) / stiff < 1e-9 * span, `${id}: dS/dq_${k} = ${g[k]}`);
    assert(st.index === st.tp[0].index || (opts?.mode === 'segments' && st.index === 0), `${id}: discrete index ${st.index}, true ${st.tp[0].index}`);
    // Close to the true action (the knots can only approximate the true path).
    const gapS = S0 - st.tp[0].S;
    assert(opts?.mode === 'segments' ? gapS > 0 && gapS < 0.15 * Math.abs(st.tp[0].S) : Math.abs(gapS) < 0.03 * (1 + Math.abs(st.tp[0].S)), `${id}: S ${S0}, true ${st.tp[0].S}`);
    if (st.tp[0].index === 0) {
      // On a minimum, random small moves of the knots, up-down and in time, all raise S.
      let x = 7;
      const r = () => { x = (x * 16807) % 2147483647; return x / 2147483647 - 0.5; };
      for (let trial = 0; trial < 20; trial++) {
        const q = Float64Array.from(path.q), s = Float64Array.from(path.s), T = d.s1 - d.s0;
        for (let k = 1; k < n - 1; k++) { q[k] += 0.01 * span * r(); s[k] += (0.01 * T * r()); }
        const S = action(L, new Path(path.s0, path.s1, q, path.mode, { s }), knotQuadrature(s, 600, !!d.singularStart)).S;
        assert(S > S0, `${id} (${path.mode}): a small change lowered S from ${S0} to ${S}`);
      }
    } else notes.push(`${id} T=${path.s1}: saddle, index ${st.index}`);
  }
  return notes.join('; ');
});

test('at the oscillator\'s saddle, bending the whole path lowers S, moving one knot raises it', () => {
  const { L, path, quad, tp } = start('harmonic', { T: 4 });
  const S0 = action(L, path, quad).S, q = Float64Array.from(path.q);
  q[2] += 0.2;
  assert(action(L, path.withKnots(q), quad).S > S0, 'one knot');
  const bent = Float64Array.from(path.q, (x, i) => x + 0.7 * Math.sin((Math.PI * path.s[i]) / 4));
  const Sb = action(L, path.withKnots(bent), quad).S;
  assert(Sb < tp[0].S, `bent ${Sb} vs true ${tp[0].S}`);
});

test('twin paradox: the straight world line has the least action, the most proper time', () => {
  const { d, params, L } = sys('twin');
  const quad = quadrature(0, 10, 400);
  const home = action(L, new Path(0, 10, straight(0, 0, 5)), quad).S;
  close(home, -10, 1e-10);
  const trip = action(L, new Path(0, 10, [0, 1.5, 2, 1.5, 0]), quad).S;
  assert(trip > home, `travelling twin ${trip}`);
  const ftl = action(L, new Path(0, 10, [0, 9, 0, -9, 0]), quad).S;
  assert(Number.isNaN(ftl), 'faster than light is undefined');
  close(d.exact(params, 0, 0, 10, 6), -8, 1e-12);
  // Reaching the turn-round sooner and coming back slower ages the traveller less as well.
  const s = [0, 2.5, 3.5, 7.5, 10];
  assert(action(L, new Path(0, 10, [0, 1, 1.5, 1, 0], 'segments', { s }), knotQuadrature(s)).S > home, 'uneven trip');
});

test('brachistochrone: the cycloid takes pi; the straight incline sqrt(2 D^2 / g Y)', () => {
  const { L } = sys('brachistochrone');
  const c = cycloid(1, Math.PI, 2);
  close(c.S, Math.PI, 1e-9);
  const quad = quadrature(0, Math.PI, 4000, true);
  const S = action(L, new Path(0, Math.PI, straight(0, 2, 5), 'segments'), quad).S;
  close(S, Math.sqrt((2 * (Math.PI ** 2 + 4)) / 2), 2e-3, 'straight incline');
});

test('light: Snell\'s law is the conserved energy along the true ray', () => {
  const { d, params, L } = sys('refraction');
  const tp = truePaths(L, 0, 3, 10, -3, { vmax: d.vmax });
  assert(tp.length === 1 && tp[0].index === 0, `${tp.length} rays`);
  const E = energy(L, tp[0].q, tp[0].v, tp[0].s);
  const lo = Math.min(...E), hi = Math.max(...E);
  close(hi - lo, 0, 1e-5, 'H along the ray');
  // H = -n cos(angle from the x axis): n1 sin(theta1) = n2 sin(theta2) from the normal.
  const ang = (v) => Math.atan(Math.abs(v));
  const v1 = tp[0].v[0], v2 = tp[0].v[tp[0].v.length - 1];
  close(params.n1 * Math.cos(ang(v1)), params.n2 * Math.cos(ang(v2)), 1e-4, 'Snell');
});

test('pendulum: more than one true path between the same events', () => {
  const { d, L } = sys('pendulum');
  const tp = truePaths(L, d.s0, d.q0, d.s1, d.q1, { vmax: d.vmax });
  assert(tp.length >= 2, `${tp.length} paths`);
  return tp.map((p) => `S=${p.S.toFixed(3)} index ${p.index}`).join('; ');
});

test('closed orbits of the pendulum: closed in phase space, solutions of the equation of motion', () => {
  const { L } = sys('pendulum'), range = [-Math.PI, Math.PI];
  assert(closedOrbits(L, 0, 0, 5, { qrange: range }).length === 0, 'no swing takes less than 2π');
  const notes = [];
  for (const [q0, T] of [[0, 8], [1, 8], [0, 16], [2.5, 8]]) {
    const orbits = closedOrbits(L, 0, q0, T, { qrange: range });
    assert(orbits.length >= 1, `q0=${q0}, T=${T}: none`);
    for (const o of orbits) {
      const n = o.q.length - 1, h = T / n;
      close(o.q[n], o.q[0], 1e-5, 'back where it started'); close(o.v[n], o.v[0], 1e-4, 'with the same velocity');
      // theta'' = -sin(theta), by differences of the samples.
      let worst = 0;
      for (let j = 1; j < n; j += 7) worst = Math.max(worst, Math.abs((o.q[j + 1] - 2 * o.q[j] + o.q[j - 1]) / (h * h) + Math.sin(o.q[j])));
      assert(worst < 1e-3, `equation of motion: residual ${worst}`);
      // S = (area of the loop) - E T, with E = v^2/2 - cos(theta).
      const E = o.v[0] ** 2 / 2 - Math.cos(o.q[0]);
      let area = 0;
      for (let j = 0; j < n; j++) area += 0.5 * (o.v[j] + o.v[j + 1]) * (o.q[j + 1] - o.q[j]);
      close(o.S, area - E * T, 3e-3 * (1 + Math.abs(o.S)), 'S = ∮p dθ - ET');
    }
    if (q0 === 2.5) assert(!orbits[0].through && Math.abs(orbits[0].q[0]) < 2.5, 'beyond the swing, the orbit starts at its turning point');
    notes.push(`θ0=${q0}, T=${T}: ${orbits.length} (S ${orbits.map((o) => o.S.toFixed(3)).join(', ')})`);
  }
  // T = 16: one swing of period 16 (near the top) and two of period 8.
  const sixteen = closedOrbits(L, 0, 0, 16, { qrange: range }), eight = closedOrbits(L, 0, 0, 8, { qrange: range });
  assert(sixteen.some((o) => Math.max(...o.q) > 2.9), 'the slow swing, near the top');
  assert(sixteen.some((o) => Math.abs(o.v0 - eight[0].v0) < 1e-6), 'twice round the period-8 swing');
  return notes.join('; ');
});

test('closed orbits of the oscillator: a family, every amplitude taking 2π with S = 0', () => {
  const { L } = sys('harmonic'), T = 2 * Math.PI;
  for (const B of [0, 0.4, -1.3]) {
    const o = oscillatorOrbit(1, 1, 0, 1, T, B);
    close(o.S, 0, 1e-12, 'formula');
    // A fine periodic spline through it has (nearly) the same action and is (nearly) stationary.
    const n = 25, s = Float64Array.from({ length: n }, (_, i) => (T * i) / (n - 1)), p = new Path(0, T, truthAt(o, s), 'spline', { s, periodic: true });
    const quad = knotQuadrature(s, 1200), S = action(L, p, quad).S;
    close(S, 0, 1e-5, `spline, B=${B}`);
    const { g } = knotDerivatives(L, p, quad, freeKnots(p), false);
    assert(Math.max(...g.map(Math.abs)) < 1e-4, `gradient ${Math.max(...g.map(Math.abs))}`);
  }
});

test('a periodic path through a closed orbit is stationary in its shared end point too', () => {
  const { L } = sys('pendulum'), o = closedOrbits(L, 0, 0.5, 8, { qrange: [-Math.PI, Math.PI] })[0];
  const n = 12, s = Float64Array.from({ length: n }, (_, i) => (8 * i) / (n - 1));
  const p = new Path(0, 8, truthAt(o, s), 'spline', { s, periodic: true });
  // Nudge the interior knots to stationary with the end held, then the end's own slope is ~0: p(T) = p(0).
  const r = stationaryKnots(L, p, { free: freeKnots(p).filter((k) => k > 0) });
  const g = knotGradient(L, r.path, knotQuadrature(s));
  assert(Math.abs(g[0]) < 1e-3 && Math.abs(g[0]) === Math.abs(g[n - 1]), `dS/dq0 = ${g[0]}`);
  return `dS/dθ(0) = ${g[0].toExponential(1)}`;
});

test('a typed Lagrangian: exp(gamma t)(v^2/2 - x^2/2) is a damped oscillator', () => {
  const gamma = 0.3, e = parseTyped('L', 'exp(gamma t) (v^2/2 - x^2/2)');
  const L = typedSystem('L', e, { gamma });
  const tp = truePaths(L, 0, 1, 6, 0, { vmax: 10 });
  assert(tp.length === 1, `${tp.length} paths`);
  // x'' + gamma x' + x = 0, x(0) = 1, x(6) = 0: x = e^{-gt/2}(cos wt + B sin wt).
  const w = Math.sqrt(1 - gamma * gamma / 4), B = -Math.cos(6 * w) / Math.sin(6 * w);
  const p = tp[0];
  let worst = 0;
  for (let j = 0; j < p.s.length; j += 20) {
    const t = p.s[j], x = Math.exp(-gamma * t / 2) * (Math.cos(w * t) + B * Math.sin(w * t));
    worst = Math.max(worst, Math.abs(p.q[j] - x));
  }
  assert(worst < 1e-5, `worst ${worst}`);
});

test('the knot gradient points downhill', () => {
  const { L } = sys('gravity');
  const quad = quadrature(0, 2, 400);
  let path = new Path(0, 2, [0, 1, 2, 1, 0]);
  let S = action(L, path, quad).S;
  for (let it = 0; it < 30; it++) {
    const g = knotGradient(L, path, quad);
    const q = Float64Array.from(path.q, (x, i) => x - 0.05 * g[i]);
    path = new Path(0, 2, q);
    const S2 = action(L, path, quad).S;
    assert(S2 <= S + 1e-9, `step ${it}: ${S2} > ${S}`);
    S = S2;
  }
  assert(S < -30, `descended to ${S}`);
});

test('phase space: H = p^2/2m + V on a grid for the oscillator', () => {
  const { L } = sys('harmonic');
  const H = hamiltonianGrid(L, [0, 1, 2], [-1, 0, 2]);
  close(H[0], 0.5, 1e-9); close(H[4], 0.5, 1e-9); close(H[8], 4, 1e-9);
  const tw = sys('twin').L, Ht = hamiltonianGrid(tw, [0], [0.75]);
  close(Ht[0], Math.sqrt(0.75 ** 2 + 1), 1e-9, 'relativistic H');
  const ml = sys('mirage').L, Hm = hamiltonianGrid(ml, [0], [0.6]);
  close(Hm[0], -Math.sqrt(1 - 0.36), 1e-7, 'light: H = -sqrt(n^2 - p^2)');
});
