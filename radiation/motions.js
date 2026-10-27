// How the charge moves: preset paths w(t) given exactly, a typed x(t), y(t), and the smoothing
// "follower" that turns the jerky positions of a mouse or finger into a path whose velocity
// stays below c and whose acceleration is continuous.  No DOM.

import { BETA_MAX } from './lw.js';

/** Gauss–Legendre nodes and weights on [-1, 1]. */
export function gaussLegendre(n) {
  const x = new Float64Array(n), w = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let z = Math.cos((Math.PI * (i + 0.75)) / (n + 0.5)), dp = 0;
    for (let it = 0; it < 100; it++) {
      let p0 = 1, p1 = z;
      for (let k = 2; k <= n; k++) { const p2 = ((2 * k - 1) * z * p1 - (k - 1) * p0) / k; p0 = p1; p1 = p2; }
      dp = (n * (z * p1 - p0)) / (z * z - 1);
      const dz = p1 / dp;
      z -= dz;
      if (Math.abs(dz) < 1e-16) break;
    }
    x[i] = z; w[i] = 2 / ((1 - z * z) * dp * dp);
  }
  return { x, w };
}
const GL = gaussLegendre(24);

// A smooth step from 0 to 1 over u in [0, 1], its derivative and its integral from 0.
const S = (u) => u * u * (3 - 2 * u);
const dS = (u) => 6 * u * (1 - u);
const IS = (u) => u * u * u * (1 - u / 2);

function set(o, x, y, vx, vy, ax, ay) { o[0] = x; o[1] = y; o[2] = vx; o[3] = vy; o[4] = ax; o[5] = ay; }

/**
 * The presets.  Each has slider parameters and make(P, c), which returns a motion:
 *   at(t, o)   o = [x, y, vx, vy, ax, ay] at time t of the motion's clock (any t, past too)
 *   end        (optional) when the interesting part is over: the demo replays it later
 *   follow     (optional) the view moves with the charge
 * Speeds are given as β = v/c, so every preset looks the same whatever c is.
 */
export const PRESETS = {
  rest: {
    label: 'At rest', params: {},
    make: () => ({ at: (t, o) => set(o, 0, 0, 0, 0, 0, 0) }),
  },

  stop: {
    label: 'Sudden stop',
    params: {
      beta: { label: 'β before', min: 0.05, max: 0.95, value: 0.6, title: 'The speed before the stop, as a fraction of c' },
      tau: { label: 'stop time (s)', min: 0.02, max: 1, value: 0.15, log: true, title: 'How long the stop takes' },
    },
    make(P, c) {
      // Coasting in from the left, it stops at the origin; the stop starts at t = ts.
      const v0 = P.beta * c, tau = P.tau, ts = Math.min(3, Math.max(0.6, (0.8 * 10) / v0 - tau / 2));
      const xs = (-v0 * tau) / 2;
      return {
        end: ts + tau,
        at(t, o) {
          const u = (t - ts) / tau;
          if (u <= 0) set(o, xs + v0 * (t - ts), 0, v0, 0, 0, 0);
          else if (u >= 1) set(o, 0, 0, 0, 0, 0, 0);
          else set(o, xs + v0 * tau * (u - IS(u)), 0, v0 * (1 - S(u)), 0, (-v0 * dS(u)) / tau, 0);
        },
      };
    },
  },

  shuttle: {
    label: 'Start & stop',
    params: {
      beta: { label: 'β top', min: 0.05, max: 0.95, value: 0.6, title: 'The top speed, as a fraction of c' },
      tau: { label: 'speed-up (s)', min: 0.02, max: 1, value: 0.15, log: true, title: 'How long starting (and stopping) takes' },
      dist: { label: 'distance', min: 1, max: 20, value: 10, title: 'How far it goes each time' },
      rest: { label: 'rest (s)', min: 0, max: 5, value: 1, title: 'How long it waits at each end' },
    },
    make(P, c) {
      // Back and forth along x between -D/2 and D/2: rest, speed up, coast, slow down, rest...
      const v0 = P.beta * c, D = P.dist, tr = P.rest;
      const tau = Math.min(P.tau, D / v0), tc = D / v0 - tau, tm = 2 * tau + tc, half = tr + tm;
      const move = (s, o) => { // s in [0, tm]: distance, speed and acceleration of one move
        if (s < tau) { const u = s / tau; o[0] = v0 * tau * IS(u); o[1] = v0 * S(u); o[2] = (v0 * dS(u)) / tau; }
        else if (s < tau + tc) { o[0] = (v0 * tau) / 2 + v0 * (s - tau); o[1] = v0; o[2] = 0; }
        else { const u = Math.min(1, (s - tau - tc) / tau); o[0] = (v0 * tau) / 2 + v0 * tc + v0 * tau * (u - IS(u)); o[1] = v0 * (1 - S(u)); o[2] = (-v0 * dS(u)) / tau; }
      };
      const m = [0, 0, 0];
      return {
        period: 2 * half,
        at(t, o) {
          let p = t % (2 * half);
          if (p < 0) p += 2 * half;
          const back = p >= half, q = back ? p - half : p, sgn = back ? -1 : 1;
          if (q < tr) { set(o, (-sgn * D) / 2, 0, 0, 0, 0, 0); return; }
          move(q - tr, m);
          set(o, sgn * (-D / 2 + m[0]), 0, sgn * m[1], 0, sgn * m[2], 0);
        },
      };
    },
  },

  uniform: {
    label: 'Uniform motion',
    params: { beta: { label: 'β', min: 0, max: 0.98, value: 0.8, title: 'The speed, as a fraction of c' } },
    make(P, c) {
      const v0 = P.beta * c;
      return { follow: true, at: (t, o) => set(o, v0 * t, 0, v0, 0, 0, 0) };
    },
  },

  oscillate: {
    label: 'Oscillation',
    params: {
      beta: { label: 'β max', min: 0.01, max: 0.95, value: 0.2, title: 'The largest speed, as a fraction of c' },
      period: { label: 'period (s)', min: 0.2, max: 5, value: 1, log: true, title: 'The radiation has wavelength λ = c × period' },
    },
    make(P, c) {
      // Up and down along y, like the textbook antenna: y = A sin ωt with Aω = βc.
      const w = (2 * Math.PI) / P.period, A = (P.beta * c) / w;
      return { at: (t, o) => set(o, 0, A * Math.sin(w * t), 0, A * w * Math.cos(w * t), 0, -A * w * w * Math.sin(w * t)) };
    },
  },

  circle: {
    label: 'Circular motion',
    params: {
      beta: { label: 'β', min: 0.01, max: 0.98, value: 0.5, title: 'The speed, as a fraction of c' },
      radius: { label: 'radius', min: 0.2, max: 6, value: 1.5, title: 'The radius of the circle' },
    },
    make(P, c) {
      const r = P.radius, w = (P.beta * c) / r;
      return {
        at(t, o) {
          const C = Math.cos(w * t), Sn = Math.sin(w * t);
          set(o, r * C, r * Sn, -r * w * Sn, r * w * C, -r * w * w * C, -r * w * w * Sn);
        },
      };
    },
  },

  deflect: {
    label: 'Deflection',
    params: {
      beta: { label: 'β', min: 0.05, max: 0.98, value: 0.8, title: 'The speed (it does not change)' },
      angle: { label: 'angle (°)', min: 5, max: 180, value: 60, title: 'How far the charge turns' },
      tau: { label: 'turn time (s)', min: 0.02, max: 2, value: 0.25, log: true, title: 'How long the turn takes' },
    },
    make(P, c) {
      // Constant speed; the direction turns smoothly from 0 to the angle, as in a magnet
      // (bremsstrahlung by a nucleus also changes the speed, but looks much the same).
      const v0 = P.beta * c, al = (P.angle * Math.PI) / 180, tau = P.tau;
      const tk = Math.min(3, Math.max(0.6, 9 / v0));
      const phi = (s) => al * S(Math.min(1, Math.max(0, s / tau)));
      // Position after s seconds of turning (from the start of the turn), by Gauss–Legendre.
      const turn = (s) => {
        let x = 0, y = 0;
        for (let i = 0; i < GL.x.length; i++) {
          const u = (s / 2) * (GL.x[i] + 1), f = phi(u);
          x += GL.w[i] * Math.cos(f); y += GL.w[i] * Math.sin(f);
        }
        return [(v0 * s * x) / 2, (v0 * s * y) / 2];
      };
      const [mx, my] = turn(tau / 2), [ex, ey] = turn(tau);
      return {
        end: tk + tau,
        at(t, o) {
          const s = t - tk;
          if (s <= 0) { set(o, -mx + v0 * s, -my, v0, 0, 0, 0); return; }
          if (s >= tau) { set(o, ex - mx + v0 * Math.cos(al) * (s - tau), ey - my + v0 * Math.sin(al) * (s - tau), v0 * Math.cos(al), v0 * Math.sin(al), 0, 0); return; }
          const [x, y] = turn(s), f = phi(s), w = (al * dS(s / tau)) / tau;
          set(o, x - mx, y - my, v0 * Math.cos(f), v0 * Math.sin(f), -v0 * w * Math.sin(f), v0 * w * Math.cos(f));
        },
      };
    },
  },

  hyperbolic: {
    label: 'Uniform acceleration',
    params: {
      beta: { label: 'β in & out', min: 0.1, max: 0.98, value: 0.9, title: 'The speed at which it arrives and leaves' },
      alpha: { label: 'g/c (1/s)', min: 0.1, max: 5, value: 1, log: true, title: 'The acceleration felt by the charge (its proper acceleration g), over c' },
    },
    make(P, c) {
      // x = x_turn − (c²/g)(√(1 + (g t/c)²) − 1): constant proper acceleration g, decelerating
      // as it comes in from the left, turning round, and going back.  Before and after, it coasts.
      const g = P.alpha * c, um = P.beta / Math.sqrt(1 - P.beta * P.beta), T = (um * c) / g;
      const L = ((c * c) / g) * (Math.sqrt(1 + um * um) - 1), t0 = T + 0.8;
      const hyp = (s, o) => {
        const q = (g * s) / c, root = Math.sqrt(1 + q * q);
        set(o, L / 2 - ((c * c) / g) * (root - 1), 0, (-g * s) / root, 0, -g / (root * root * root), 0);
      };
      return {
        end: t0 + T,
        at(t, o) {
          const s = t - t0;
          if (Math.abs(s) <= T) { hyp(s, o); return; }
          const e = s > 0 ? T : -T;
          hyp(e, o);
          o[0] += o[2] * (s - e); o[4] = 0;
        },
      };
    },
  },
};

/**
 * A typed path: fx and fy map a Float64Array of times to a Float64Array of positions.  The
 * velocity and acceleration are central differences.  many(ts) does many times at once.
 */
export function typedMotion(fx, fy) {
  // Five-point differences: errors of order d⁴ (and roundoff of order 1e-16 |x|/d²).
  const d = 2e-3;
  const many = (ts) => {
    const n = ts.length, tt = new Float64Array(5 * n);
    for (let i = 0; i < n; i++) for (let j = 0; j < 5; j++) tt[5 * i + j] = ts[i] + (j - 2) * d;
    const X = fx(tt), Y = fy(tt), out = new Float64Array(6 * n);
    for (let i = 0; i < n; i++) {
      for (const [F, k] of [[X, 0], [Y, 1]]) {
        const a = F[5 * i], b = F[5 * i + 1], c = F[5 * i + 2], e = F[5 * i + 3], f = F[5 * i + 4];
        out[6 * i + k] = c;
        out[6 * i + 2 + k] = (a - 8 * b + 8 * e - f) / (12 * d);
        out[6 * i + 4 + k] = (-a + 16 * b - 30 * c + 16 * e - f) / (12 * d * d);
      }
    }
    return out;
  };
  const one = new Float64Array(1);
  return {
    many,
    at(t, o) { one[0] = t; const r = many(one); for (let k = 0; k < 6; k++) o[k] = r[k]; },
  };
}

/**
 * Where the pointer was: the positions of pointer events, joined by straight lines in time and
 * read a little late (delay), so that the target moves continuously instead of jumping at
 * every event.  (Mice report 60 to 1000 times a second; jumps would show as ripples in the
 * radiation.)  When the pointer rests, the target rests where it was last seen.
 */
export class PointerPath {
  constructor(delay = 0.03) { this.delay = delay; this.t = []; this.x = []; this.y = []; }
  clear() { this.t.length = this.x.length = this.y.length = 0; }
  add(t, x, y) {
    const n = this.t.length;
    if (n && t <= this.t[n - 1]) { this.x[n - 1] = x; this.y[n - 1] = y; return; }
    this.t.push(t); this.x.push(x); this.y.push(y);
    if (n > 512) { this.t.splice(0, 256); this.x.splice(0, 256); this.y.splice(0, 256); }
  }
  get empty() { return this.t.length === 0; }
  /** The target at time t (seconds, same clock as add()). */
  at(t, out) {
    const T = this.t, n = T.length, s = t - this.delay;
    if (!n) return false;
    if (s >= T[n - 1]) { out[0] = this.x[n - 1]; out[1] = this.y[n - 1]; return true; }
    if (s <= T[0]) { out[0] = this.x[0]; out[1] = this.y[0]; return true; }
    let i = n - 2;
    while (i > 0 && T[i] > s) i--;
    const f = (s - T[i]) / (T[i + 1] - T[i]);
    out[0] = this.x[i] + f * (this.x[i + 1] - this.x[i]);
    out[1] = this.y[i] + f * (this.y[i + 1] - this.y[i]);
    return true;
  }
}

/**
 * Fill a Trajectory with a motion's past: samples from tNow − span to tNow (on the demo's
 * clock; the motion's clock is the demo's minus `offset`).  Returns the largest β and |a| seen.
 */
export function prefill(traj, motion, tNow, offset, span, c) {
  const h = traj.h, n = Math.min(traj.cap, Math.ceil(span / h) + 1), t0 = tNow - (n - 1) * h;
  let samples;
  if (motion.many) {
    const ts = new Float64Array(n);
    for (let k = 0; k < n; k++) ts[k] = t0 + k * h - offset;
    samples = motion.many(ts);
  } else {
    samples = new Float64Array(6 * n);
    const o = new Float64Array(6);
    for (let k = 0; k < n; k++) { motion.at(t0 + k * h - offset, o); samples.set(o, 6 * k); }
  }
  let bmax = 0, amax = 0;
  for (let k = 0; k < n; k++) {
    const s = 6 * k;
    bmax = Math.max(bmax, Math.hypot(samples[s + 2], samples[s + 3]) / c);
    amax = Math.max(amax, Math.hypot(samples[s + 4], samples[s + 5]));
    if (k === 0) traj.reset(t0, samples[0], samples[1], samples[2], samples[3], samples[4], samples[5]);
    else traj.push(samples[s], samples[s + 1], samples[s + 2], samples[s + 3], samples[s + 4], samples[s + 5]);
  }
  return { bmax, amax };
}

/**
 * The follower: the charge chases a target point (the pointer) through three smoothing stages,
 *   the target is low-passed:            p' = (target − p)/τ₁
 *   the charge wants to close the gap:   v_want = (p − x)/τ₂, but never faster than BETA_MAX c
 *                                        (a tanh saturation, so the speed stays below c smoothly)
 *   its velocity relaxes to that:        v' = (v_want − v)/τ₃,   x' = v.
 * With τ₂ = 4τ₃ it is critically damped (no overshoot when it stops).  The acceleration is a
 * continuous function of the state, so it never jumps, and |v| < BETA_MAX c always.
 */
export class Follower {
  constructor({ tau1 = 0.02, tau2 = 0.1, tau3 = 0.025 } = {}) {
    this.tau1 = tau1; this.tau2 = tau2; this.tau3 = tau3;
    this.s = new Float64Array(6);   // px, py, x, y, vx, vy
    this.k = [0, 1, 2, 3].map(() => new Float64Array(6));
    this.tmp = new Float64Array(6);
    this.ax = 0; this.ay = 0;
  }

  /** Start from the charge's present state; the smoothed target starts where the charge is. */
  start(x, y, vx, vy, c) {
    this.c = c;
    this.s.set([x, y, x, y, vx, vy]);
    this.accel(this.s, x, y, c);
  }

  get x() { return this.s[2]; }
  get y() { return this.s[3]; }
  get vx() { return this.s[4]; }
  get vy() { return this.s[5]; }

  deriv(s, tx, ty, c, out) {
    const V = BETA_MAX * c, dx = s[0] - s[2], dy = s[1] - s[3], m = Math.sqrt(dx * dx + dy * dy);
    const f = m > 1e-12 * V * this.tau2 ? (V * Math.tanh(m / (V * this.tau2))) / m : 1 / this.tau2;
    out[0] = (tx - s[0]) / this.tau1; out[1] = (ty - s[1]) / this.tau1;
    out[2] = s[4]; out[3] = s[5];
    out[4] = (dx * f - s[4]) / this.tau3; out[5] = (dy * f - s[5]) / this.tau3;
  }

  accel(s, tx, ty, c) {
    this.deriv(s, tx, ty, c, this.tmp);
    this.ax = this.tmp[4]; this.ay = this.tmp[5];
  }

  /** Advance by dt towards the target (tx, ty), in `sub` RK4 steps. */
  step(dt, tx, ty, c, sub = 2) {
    this.c = c;
    const s = this.s, [k1, k2, k3, k4] = this.k, t = this.tmp, h = dt / sub;
    for (let n = 0; n < sub; n++) {
      this.deriv(s, tx, ty, c, k1);
      for (let i = 0; i < 6; i++) t[i] = s[i] + 0.5 * h * k1[i];
      this.deriv(t, tx, ty, c, k2);
      for (let i = 0; i < 6; i++) t[i] = s[i] + 0.5 * h * k2[i];
      this.deriv(t, tx, ty, c, k3);
      for (let i = 0; i < 6; i++) t[i] = s[i] + h * k3[i];
      this.deriv(t, tx, ty, c, k4);
      for (let i = 0; i < 6; i++) s[i] += (h / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]);
    }
    // Belt and braces: the speed limit.
    const v = Math.hypot(s[4], s[5]), V = BETA_MAX * c;
    if (v > V) { s[4] *= V / v; s[5] *= V / v; }
    this.accel(s, tx, ty, c);
  }
}
