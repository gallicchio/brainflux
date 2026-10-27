// The systems: Lagrangians with end points, display ranges and parameters, chosen so that the
// true path is one students solve in class or in homework, and so that each teaches something
// about the action.  Units are whatever the numbers say (m = 1, g = 10 for a thrown ball...).

import { parse } from '../lib/expr.js';

const fill = (n, v) => new Float64Array(n).fill(v);
const map3 = (q, v, s, f) => { const out = new Float64Array(q.length); for (let i = 0; i < q.length; i++) out[i] = f(q[i], v[i], s[i]); return out; };

/** L = (m/2) v^2 - V(q, s) from a function V. */
function mechanical(m, V, dVdq) {
  return {
    L: (q, v, s) => map3(q, v, s, (x, u, t) => 0.5 * m * u * u - V(x, t)),
    accel: dVdq ? (q, v, s) => map3(q, v, s, (x, u, t) => -dVdq(x, t) / m) : undefined,
    p: (q, v) => Float64Array.from(v, (u) => m * u),
    vOfP: (q, p) => Float64Array.from(p, (x) => x / m),
    kinetic: (q, v) => Float64Array.from(v, (u) => 0.5 * m * u * u),
  };
}

export const SYSTEMS = [
  {
    id: 'free', label: 'Free particle',
    s: 't', q: 'x', s0: 0, s1: 2, q0: 0, q1: 4, qrange: [-2, 7], knots: 5, vmax: 30,
    params: { m: { value: 1, min: 0.1, max: 5 } },
    formula: 'L = \\tfrac12 m\\dot x^2',
    make: ({ m }) => mechanical(m, () => 0, () => 0),
    exact: ({ m }, s0, q0, s1, q1) => (m * (q1 - q0) ** 2) / (2 * (s1 - s0)),
    blurb: 'The true path is a straight line at constant speed.  Any detour costs action.',
  },
  {
    id: 'gravity', label: 'Throw and catch',
    s: 't', q: 'x', s0: 0, s1: 2, q0: 0, q1: 0, qrange: [-3, 9], knots: 5, vmax: 60,
    params: { m: { value: 1, min: 0.1, max: 5 }, g: { value: 10, min: 0, max: 20 } },
    formula: 'L = \\tfrac12 m\\dot x^2 - mgx',
    make: ({ m, g }) => mechanical(m, (x) => m * g * x, () => m * g),
    exact: ({ m, g }, s0, q0, s1, q1) => {
      const T = s1 - s0;
      // x(t) = q0 + (q1 - q0) t/T + g t (T - t)/2: S = m (q1-q0)^2/2T - m g (q0+q1) T/2 - m g^2 T^3/24.
      return (m * (q1 - q0) ** 2) / (2 * T) - (m * g * (q0 + q1) * T) / 2 - (m * g * g * T ** 3) / 24;
    },
    blurb: 'A ball thrown up and caught two seconds later.  The parabola balances kinetic energy (spent getting high) against potential energy (earned while up there).',
  },
  {
    id: 'harmonic', label: 'Harmonic oscillator',
    s: 't', q: 'x', s0: 0, s1: 2, q0: 1, q1: 0.5, qrange: [-3, 3], knots: 6, vmax: 30, tmax: 7,
    params: { m: { value: 1, min: 0.1, max: 5 }, omega: { value: 1, min: 0.1, max: 3 } },
    formula: 'L = \\tfrac12 m\\dot x^2 - \\tfrac12 m\\omega^2x^2',
    make: ({ m, omega }) => mechanical(m, (x) => 0.5 * m * omega * omega * x * x, (x) => m * omega * omega * x),
    exact: ({ m, omega }, s0, q0, s1, q1) => {
      const w = omega, T = s1 - s0;
      return ((m * w) / (2 * Math.sin(w * T))) * ((q0 * q0 + q1 * q1) * Math.cos(w * T) - 2 * q0 * q1);
    },
    blurb: 'Shorter than half a period (T < π/ω), the true path minimises the action.  Longer, it is only a saddle point: there are nearby paths with less action.',
  },
  {
    id: 'pendulum', label: 'Pendulum',
    s: 't', q: 'θ', s0: 0, s1: 8, q0: 0, q1: 1, qrange: [-4, 4], knots: 8, vmax: 6, tmax: 20,
    params: {},
    formula: 'L = \\tfrac12\\dot\\theta^2 + \\cos\\theta',
    make: () => mechanical(1, (x) => -Math.cos(x), (x) => Math.sin(x)),
    blurb: 'A nonlinear system: between the same two events there can be several true paths, swinging different ways, each with its own action.',
  },
  {
    id: 'twin', label: 'Twin paradox', vertical: true,
    s: 't', q: 'x', s0: 0, s1: 10, q0: 0, q1: 0, qrange: [-7, 7], knots: 5, vmax: 0.999,
    params: { m: { value: 1, min: 0.1, max: 5 } },
    formula: 'L = -mc^2\\sqrt{1-\\dot x^2/c^2}',
    make: ({ m }) => ({
      L: (q, v) => Float64Array.from(v, (u) => (Math.abs(u) < 1 ? -m * Math.sqrt(1 - u * u) : NaN)),
      accel: (q) => new Float64Array(q.length),
      p: (q, v) => Float64Array.from(v, (u) => (m * u) / Math.sqrt(1 - u * u)),
      vOfP: (q, p) => Float64Array.from(p, (x) => x / Math.sqrt(x * x + m * m)),
    }),
    exact: ({ m }, s0, q0, s1, q1) => -m * Math.sqrt((s1 - s0) ** 2 - (q1 - q0) ** 2),
    blurb: 'A free particle in special relativity (c = 1).  Its action is −m times its proper time, the time its own clock shows.  The twin who stays home (the straight world line) ages the most: the action is least, the proper time greatest.',
  },
  {
    id: 'mirage', label: 'Light: mirage',
    s: 'x', q: 'y', s0: 0, s1: 10, q0: 0, q1: 0, qrange: [-1.5, 4], knots: 5, vmax: 3,
    params: { n0: { value: 1, min: 1, max: 2 }, alpha: { value: 0.05, min: -0.2, max: 0.2 } },
    formula: 'L = n(y)\\sqrt{1+y\'^2},\\quad n = n_0+\\alpha y',
    make: ({ n0, alpha }) => ({
      L: (q, v) => map3(q, v, q, (y, u) => { const n = n0 + alpha * y; return n > 0 ? n * Math.sqrt(1 + u * u) : NaN; }),
    }),
    blurb: 'Fermat\'s principle: light takes the path of least optical length ∫n ds.  Over a hot road the air near the ground is thinner (lower n, α > 0), so the quickest path dips down into it and curves back up, towards the higher index: light from the sky reaches you from below, and the road looks wet.',
  },
  {
    id: 'refraction', label: 'Light: refraction',
    s: 'x', q: 'y', s0: 0, s1: 10, q0: 3, q1: -3, qrange: [-5, 5], knots: 7, vmax: 4,
    params: { n1: { value: 1, min: 1, max: 2 }, n2: { value: 1.5, min: 1, max: 2.5 } },
    formula: 'L = n(y)\\sqrt{1+y\'^2}',
    make: ({ n1, n2 }) => ({
      // Air (n1) above y = 0, glass (n2) below, with a thin smooth interface.
      L: (q, v) => map3(q, v, q, (y, u) => ((n1 + n2) / 2 + ((n1 - n2) / 2) * Math.tanh(y / 0.15)) * Math.sqrt(1 + u * u)),
    }),
    blurb: 'From air into glass.  The least-time path bends at the surface so that n₁ sin θ₁ = n₂ sin θ₂ (θ from the normal): Snell\'s law is the conserved "energy" in the phase-space picture.',
  },
  {
    id: 'brachistochrone', label: 'Brachistochrone', flip: true, singularStart: true, lockStart: true,
    s: 'x', q: 'depth', s0: 0, s1: Math.PI, q0: 0, q1: 2, qrange: [-0.4, 3], knots: 6, vmax: 50,
    params: { g: { value: 1, min: 0.2, max: 5 } },
    formula: 'L = \\frac{\\sqrt{1+y\'^2}}{\\sqrt{2gy}}',
    make: ({ g }) => ({
      L: (q, v) => map3(q, v, q, (y, u) => (y > 0 ? Math.sqrt(1 + u * u) / Math.sqrt(2 * g * y) : NaN)),
    }),
    // The shooting method can't start at y = 0 (L is infinite there): the cycloid, directly.
    truePaths: ({ g }, s0, q0, s1, q1) => [cycloid(g, s1 - s0, q1 - q0)].filter(Boolean),
    exact: ({ g }, s0, q0, s1, q1) => cycloid(g, s1 - s0, q1 - q0)?.S,
    blurb: 'The curve of fastest descent (Johann Bernoulli, 1696).  The "action" is the time a bead takes to slide down it from rest: the true path is a cycloid, faster than the straight line though longer.',
  },
  {
    id: 'typedV', label: 'Type V(x, t)', typed: 'V',
    s: 't', q: 'x', s0: 0, s1: 3, q0: -1, q1: 1, qrange: [-3, 3], knots: 6, vmax: 20, tmax: 10,
    source: 'x^4/4 - x^2', params: { m: { value: 1, min: 0.1, max: 5 } },
    formula: 'L = \\tfrac12 m\\dot x^2 - V(x,t)',
    blurb: 'Any potential: the true paths are found numerically, by shooting.',
  },
  {
    id: 'typedL', label: 'Type L(x, v, t)', typed: 'L',
    s: 't', q: 'x', s0: 0, s1: 6, q0: 1, q1: 0, qrange: [-2, 2], knots: 7, vmax: 10, tmax: 15,
    source: 'exp(gamma t) (v^2/2 - x^2/2)', params: {},
    formula: 'L(x,\\dot x,t)',
    blurb: 'Any Lagrangian, with v standing for the velocity.  The example, e^{γt}(v²/2 − x²/2), is a damped oscillator: friction from a stationary action.',
  },
];

/** A Lagrangian from a typed V(x, t) or L(x, v, t), with its parameter values. */
export function typedSystem(kind, expr, params, m = 1) {
  const env = (q, v, s) => ({ x: q, v, t: s, m, ...params });
  if (kind === 'V') {
    return {
      L: (q, v, s) => {
        const V = expr.evaluate(env(q, v, s), q.length).re;
        const out = new Float64Array(q.length);
        for (let i = 0; i < q.length; i++) out[i] = 0.5 * m * v[i] * v[i] - V[i];
        return out;
      },
      p: (q, v) => Float64Array.from(v, (u) => m * u),
      vOfP: (q, p) => Float64Array.from(p, (x) => x / m),
    };
  }
  return { L: (q, v, s) => expr.evaluate(env(q, v, s), q.length).re };
}

export function parseTyped(kind, source) {
  return parse(source, { variables: kind === 'V' ? ['x', 't'] : ['x', 'v', 't'] });
}

/**
 * The cycloid through (0, 0) and (X, Y) (Y measured downwards): x = a(θ - sin θ),
 * y = a(1 - cos θ).  Returns {s, q, v, S, index} sampled at 401 equal steps in x.
 */
export function cycloid(g, X, Y) {
  if (!(X > 0 && Y > 0)) return null;
  // (θ - sin θ)/(1 - cos θ) = X/Y for θ in (0, 2π): increasing in θ.
  const f = (th) => (th - Math.sin(th)) / (1 - Math.cos(th)) - X / Y;
  let lo = 1e-6, hi = 2 * Math.PI - 1e-6;
  for (let i = 0; i < 100; i++) { const mid = (lo + hi) / 2; if (f(mid) > 0) hi = mid; else lo = mid; }
  const T = (lo + hi) / 2, a = Y / (1 - Math.cos(T));
  const n = 400, s = new Float64Array(n + 1), q = new Float64Array(n + 1), v = new Float64Array(n + 1);
  for (let j = 0; j <= n; j++) {
    const x = (X * j) / n;
    let tlo = 0, thi = T;
    for (let i = 0; i < 60; i++) { const mid = (tlo + thi) / 2; if (a * (mid - Math.sin(mid)) > x) thi = mid; else tlo = mid; }
    const th = (tlo + thi) / 2;
    s[j] = x; q[j] = a * (1 - Math.cos(th));
    v[j] = th > 0 ? Math.sin(th) / (1 - Math.cos(th)) : Infinity;
  }
  return { s, q, v, S: T * Math.sqrt(a / g), index: 0 };
}
