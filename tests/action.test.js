import { test, assert, close } from './harness.js';
import { Path, action, quadrature, truePaths, knotGradient, energy, hamiltonianGrid } from '../action/physics.js';
import { SYSTEMS, typedSystem, parseTyped, cycloid } from '../action/systems.js';

const sys = (id, over = {}) => {
  const d = SYSTEMS.find((s) => s.id === id);
  const params = Object.fromEntries(Object.entries(d.params).map(([k, v]) => [k, v.value]));
  Object.assign(params, over);
  return { d, params, L: d.make(params) };
};
const straight = (q0, q1, n) => Array.from({ length: n }, (_, i) => q0 + ((q1 - q0) * i) / (n - 1));

test('the spline passes through its knots', () => {
  const k = [0, 1, -1, 2, 0.5];
  const p = new Path(0, 4, k);
  const { q } = p.sample([0, 1, 2, 3, 4]);
  for (let i = 0; i < 5; i++) close(q[i], k[i], 1e-12);
});

test('free particle: the straight line has S = m dx^2 / 2T and is the true path', () => {
  const { d, params, L } = sys('free');
  const quad = quadrature(0, 2, 400);
  const S = action(L, new Path(0, 2, straight(0, 4, 5)), quad).S;
  close(S, d.exact(params, 0, 0, 2, 4), 1e-10);
  const tp = truePaths(L, 0, 0, 2, 4, { vmax: d.vmax });
  assert(tp.length === 1 && tp[0].index === 0, `${tp.length} paths`);
  close(tp[0].S, 4, 1e-6);
});

test('throw and catch: the parabola, S = -m g^2 T^3 / 24, a minimum', () => {
  const { d, params, L } = sys('gravity');
  const tp = truePaths(L, 0, 0, 2, 0, { vmax: d.vmax });
  assert(tp.length === 1, `${tp.length} paths`);
  close(tp[0].S, d.exact(params, 0, 0, 2, 0), 1e-8);
  close(tp[0].S, -100 * 8 / 24, 1e-8);
  assert(tp[0].index === 0, 'minimum');
  // The spline through the parabola's own knots comes close from above.
  const knots = Array.from({ length: 7 }, (_, i) => { const t = (2 * i) / 6; return 5 * t * (2 - t); });
  const S = action(L, new Path(0, 2, knots), quadrature(0, 2, 400)).S;
  assert(S >= tp[0].S - 1e-9 && S - tp[0].S < 0.5, `spline S ${S}`);
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
});

test('brachistochrone: the cycloid takes pi; the straight incline sqrt(2 D^2 / g Y)', () => {
  const { d, params, L } = sys('brachistochrone');
  const c = cycloid(1, Math.PI, 2);
  close(c.S, Math.PI, 1e-9);
  const quad = quadrature(0, Math.PI, 4000, true);
  const S = action(L, new Path(0, Math.PI, straight(0, 2, 5), 'segments'), quad).S;
  close(S, Math.sqrt((2 * (Math.PI ** 2 + 4)) / 2), 2e-3, 'straight incline');
  // The cycloid, sampled onto a fine spline, gives back its time.
  const n = 41, knots = Array.from({ length: n }, (_, i) => c.q[Math.round((400 * i) / (n - 1))]);
  const Sc = action(L, new Path(0, Math.PI, knots), quad).S;
  close(Sc, Math.PI, 0.02, 'cycloid through 41 knots');
  void params; void d;
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
