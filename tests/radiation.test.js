import { test, assert, close } from './harness.js';
import { Trajectory, AnalyticPath, LW, lienardPower, larmorPower, dPdOmega, seedDirection, BETA_MAX } from '../radiation/lw.js';
import { fieldLines } from '../radiation/lines.js';
import { PRESETS, Follower, PointerPath, typedMotion, prefill, gaussLegendre } from '../radiation/motions.js';

const PI = Math.PI;

/** A preset as an AnalyticPath. */
function presetPath(name, params, c) {
  const P = { ...Object.fromEntries(Object.entries(PRESETS[name].params).map(([k, p]) => [k, p.value])), ...params };
  const m = PRESETS[name].make(P, c);
  return { motion: m, path: new AnalyticPath((t, o) => m.at(t, o)) };
}

/** The flux of E through a sphere (centre cx, cy, cz; radius rho) at time t. */
function flux(lw, t, cx, cy, cz, rho, nth = 64, nph = 64, part = 'total') {
  const { x: mu, w } = gaussLegendre(nth);
  let s = 0, guess = NaN;
  flux.ratio = 0;
  for (let i = 0; i < nth; i++) {
    const st = Math.sqrt(1 - mu[i] * mu[i]);
    for (let j = 0; j < nph; j++) {
      const ph = (2 * PI * (j + 0.5)) / nph, nx = st * Math.cos(ph), ny = st * Math.sin(ph), nz = mu[i];
      lw.field(cx + rho * nx, cy + rho * ny, cz + rho * nz, t, guess);
      guess = lw.tr;
      const [ex, ey, ez] = part === 'velocity' ? [lw.evx, lw.evy, lw.evz] : part === 'acceleration' ? [lw.eax, lw.eay, lw.eaz] : [lw.ex, lw.ey, lw.ez];
      s += w[i] * (2 * PI / nph) * rho * rho * (ex * nx + ey * ny + ez * nz);
      flux.ratio = Math.max(flux.ratio, Math.hypot(lw.eax, lw.eay, lw.eaz) / Math.hypot(lw.evx, lw.evy, lw.evz));
    }
  }
  return s;
}

test('radiation: the sampled path is the quintic through position, velocity and acceleration', () => {
  // A quintic path is reproduced exactly between samples.
  const p = (t) => [1 + 2 * t - t ** 3 + 0.5 * t ** 5, -t + 3 * t ** 2 + 0.2 * t ** 4];
  const d = (t) => [2 - 3 * t ** 2 + 2.5 * t ** 4, -1 + 6 * t + 0.8 * t ** 3];
  const dd = (t) => [-6 * t + 10 * t ** 3, 6 + 2.4 * t ** 2];
  const T = new Trajectory(0.1, 64);
  T.reset(0, ...p(0), ...d(0), ...dd(0));
  for (let k = 1; k <= 20; k++) { const t = 0.1 * k; T.push(...p(t), ...d(t), ...dd(t)); }
  let err = 0;
  for (let t = 0.013; t < 2; t += 0.0371) {
    T.at(t);
    const [x, y] = p(t), [vx, vy] = d(t), [ax, ay] = dd(t);
    err = Math.max(err, Math.abs(T.wx - x), Math.abs(T.wy - y), Math.abs(T.vx - vx), Math.abs(T.vy - vy), Math.abs(T.ax - ax), Math.abs(T.ay - ay));
  }
  assert(err < 1e-11, `quintic reproduced to ${err}`);
  // Before the first sample: uniform motion with the first sample's velocity.
  T.at(-1);
  close(T.wx, 1 - 2, 1e-14); close(T.vx, 2, 1e-14); close(T.ax, 0, 0);
  // The ring forgets the oldest samples.
  const R = new Trajectory(1, 8);
  R.reset(0, 0, 0, 1, 0);
  for (let k = 1; k <= 20; k++) R.push(k, 0, 1, 0, 0, 0);
  close(R.tStart, 13, 1e-12); close(R.tEnd, 20, 1e-12);
  R.at(5.5); close(R.wx, 5.5, 1e-12);
  return `max error ${err.toExponential(1)}`;
});

test('radiation: a charge at rest has the Coulomb field', () => {
  const T = new Trajectory();
  T.reset(0, 0.3, -0.2);
  const lw = new LW(T, 5);
  for (const [x, y, z] of [[2, 1, 0], [-3, 0.5, 1], [0.3, -0.2, 4], [10, -7, -3]]) {
    lw.field(x, y, z, 0);
    const dx = x - 0.3, dy = y + 0.2, r = Math.hypot(dx, dy, z), r3 = r ** 3;
    close(lw.ex, dx / r3, 1e-14 / r ** 2); close(lw.ey, dy / r3, 1e-14 / r ** 2); close(lw.ez, z / r3, 1e-14 / r ** 2);
    close(lw.eax, 0, 0); close(lw.R, r, 1e-12);
  }
});

test('radiation: uniform motion gives Heaviside\'s field, pointing from the present position', () => {
  // E = (1 − β²) R_p / (R_p³ (1 − β² sin²ψ)^{3/2}), R_p from the present position.
  const c = 3;
  let worst = 0;
  for (const beta of [0.1, 0.6, 0.9, 0.98]) {
    const v = beta * c, ang = 0.7, vx = v * Math.cos(ang), vy = v * Math.sin(ang);
    const sampled = new Trajectory();
    sampled.reset(2, 1, -1, vx, vy);   // at (1, -1) at t = 2, coasting forever
    const exact = new AnalyticPath((t, o) => { o[0] = 1 + vx * (t - 2); o[1] = -1 + vy * (t - 2); o[2] = vx; o[3] = vy; o[4] = o[5] = 0; });
    for (const path of [sampled, exact]) {
      const lw = new LW(path, c);
      for (const [x, y, z] of [[3, 2, 0], [-2, 1, 0], [1, -1, 2], [4, -5, -1], [1 + Math.cos(ang), -1 + Math.sin(ang), 0]]) {
        lw.field(x, y, z, 2);
        const rx = x - 1, ry = y + 1, rz = z, r = Math.hypot(rx, ry, rz);
        const cosPsi = (rx * Math.cos(ang) + ry * Math.sin(ang)) / r, sin2 = 1 - cosPsi * cosPsi;
        const f = (1 - beta * beta) / (r ** 3 * (1 - beta * beta * sin2) ** 1.5);
        for (const [a, b] of [[lw.ex, f * rx], [lw.ey, f * ry], [lw.ez, f * rz]]) {
          const e = Math.abs(a - b) / (f * r);
          worst = Math.max(worst, e);
          assert(e < 1e-10, `beta ${beta} at ${x},${y},${z}: ${a} vs ${b}`);
        }
      }
    }
    // Ahead the field is weaker by γ², beside it stronger by γ: a ratio of γ³.
    const lw = new LW(exact, c), g = 1 / Math.sqrt(1 - beta * beta);
    lw.field(1 + 2 * Math.cos(ang), -1 + 2 * Math.sin(ang), 0, 2);
    const ahead = Math.hypot(lw.ex, lw.ey);
    lw.field(1 - 2 * Math.sin(ang), -1 + 2 * Math.cos(ang), 0, 2);
    const beside = Math.hypot(lw.ex, lw.ey);
    close(beside / ahead, g ** 3, 1e-9 * g ** 3, `beta ${beta}`);
  }
  return `largest relative error ${worst.toExponential(1)}`;
});

test('radiation: the retarded time solves |r − w(t_r)| = c(t − t_r), quickly', () => {
  const c = 2;
  const { path } = presetPath('circle', { beta: 0.95, radius: 1 }, c);
  const lw = new LW(path, c);
  let worst = 0, iters = 0, n = 0;
  for (let k = 0; k < 200; k++) {
    const x = 6 * Math.sin(1.3 * k), y = 5 * Math.cos(0.7 * k), z = (k % 5) - 2, t = 0.37 * k;
    const tr = lw.retarded(x, y, z, t);
    path.at(tr);
    const R = Math.hypot(x - path.wx, y - path.wy, z);
    worst = Math.max(worst, Math.abs(R - c * (t - tr)) / (1 + c * Math.abs(t)));
    // A brute-force bisection agrees.
    let lo = t - 100, hi = t;
    for (let i = 0; i < 200; i++) {
      const m = 0.5 * (lo + hi);
      path.at(m);
      if (c * (t - m) - Math.hypot(x - path.wx, y - path.wy, z) > 0) lo = m; else hi = m;
    }
    close(tr, 0.5 * (lo + hi), 1e-11 * (1 + Math.abs(t)));
    // A neighbour's answer as a guess: two or three Newton steps.
    lw.retarded(x + 0.01, y, z, t, tr);
    iters += lw.iterations; n++;
  }
  assert(worst < 1e-12, `residual ${worst}`);
  assert(iters / n <= 4, `warm-started solves take ${iters / n} iterations`);
  return `residual ${worst.toExponential(1)}, ${(iters / n).toFixed(1)} iterations from a neighbour's guess`;
});

test('radiation: E = −∇φ − ∂A/c∂t and B = ∇×A from the Liénard–Wiechert potentials', () => {
  // φ = q/(κR), A = qβ/(κR) (Gaussian units); derivatives by central differences.
  const c = 1.5;
  // (Smooth paths only: where the jerk jumps, as at the ends of the presets' stops and turns,
  // the differences would be accurate only to first order.)
  for (const [name, P, dt] of [['circle', { beta: 0.7, radius: 1 }, 0], ['oscillate', { beta: 0.9, period: 2 }, 0]]) {
    const { path } = presetPath(name, P, c);
    const lw = new LW(path, c);
    const pot = (x, y, z, t) => {
      const tr = lw.retarded(x, y, z, t);
      path.at(tr);
      const dx = x - path.wx, dy = y - path.wy, R = Math.hypot(dx, dy, z);
      const kR = R - (dx * path.vx + dy * path.vy) / c;
      return [1 / kR, path.vx / c / kR, path.vy / c / kR];
    };
    for (const [x, y, z, t0] of [[2, 1.5, 0.7, 3], [-1, 0.4, 0, 2], [0.5, -2, -1, 2.1], [3, 0.2, 0.1, 2.6]]) {
      const d = 1e-4, t = t0 + dt;
      const g = (i) => {
        const a = [x, y, z, t], b = [x, y, z, t];
        a[i] += d; b[i] -= d;
        const pa = pot(...a), pb = pot(...b);
        return pa.map((v, k) => (v - pb[k]) / (2 * d));
      };
      const [dX, dY, dZ, dT] = [g(0), g(1), g(2), g(3)];
      const E = [-dX[0] - dT[1] / c, -dY[0] - dT[2] / c, -dZ[0]];
      // B = ∇×A with A = (Ax, Ay, 0): (−∂z Ay, ∂z Ax, ∂x Ay − ∂y Ax).
      const B = [-dZ[2], dZ[1], dX[2] - dY[1]];
      lw.field(x, y, z, t);
      const Bf = lw.bfield(), scale = Math.hypot(lw.ex, lw.ey, lw.ez);
      const errE = Math.hypot(E[0] - lw.ex, E[1] - lw.ey, E[2] - lw.ez) / scale;
      const errB = Math.hypot(B[0] - Bf[0], B[1] - Bf[1], B[2] - Bf[2]) / scale;
      assert(errE < 1e-6 && errB < 1e-6, `${name} at ${[x, y, z, t]}: E error ${errE}, B error ${errB}`);
      // And the acceleration part matters here.
      assert(Math.hypot(lw.eax, lw.eay, lw.eaz) > 0.05 * scale, `${name}: the acceleration field is not negligible`);
    }
  }
});

/** A stop with no corners at all: v = v0 (1 − tanh(t/τ))/2 along x. */
function smoothStop(v0, tau) {
  const lncosh = (u) => Math.abs(u) + Math.log1p(Math.exp(-2 * Math.abs(u))) - Math.LN2;
  return new AnalyticPath((t, o) => {
    const u = t / tau, th = Math.tanh(u);
    o[0] = (v0 / 2) * (t - tau * lncosh(u)); o[1] = 0;
    o[2] = (v0 / 2) * (1 - th); o[3] = 0; o[4] = (-v0 / (2 * tau)) * (1 - th * th); o[5] = 0;
  });
}

test('radiation: Gauss\'s law, flux 4πq through any sphere round the charge, even as a kink crosses it', () => {
  const c = 1, notes = [];
  for (const [beta, tau] of [[0.7, 0.1], [0.9, 0.15]]) {
    const path = smoothStop(beta * c, tau), lw = new LW(path, c), t = 0.4;
    // The sphere is inside the shell: the field on it is far from Coulomb's.
    flux(lw, t, 0, 0, 0, 0.35, 48, 48);
    assert(flux.ratio > 0.5, `the radiation field is as strong as the velocity field on the sphere (ratio ${flux.ratio})`);
    let worst = 0;
    for (const [cx, cy, cz, rho] of [[0, 0, 0, 0.35], [0.2, 0.1, 0.05, 0.6], [-0.3, 0.2, 0, 1.2]]) {
      const f = flux(lw, t, cx, cy, cz, rho, 128, 128);
      close(f / (4 * PI), 1, 1e-8, `beta ${beta}, sphere at ${[cx, cy, cz]} radius ${rho}:`);
      worst = Math.max(worst, Math.abs(f / (4 * PI) - 1));
    }
    close(flux(lw, t, 1.5, 0.2, 0, 0.6, 128, 128), 0, 1e-8, 'a sphere without the charge:');
    // The velocity part alone does not obey Gauss's law: the radiation field makes up the rest.
    const fv = flux(lw, t, 0.2, 0.1, 0.05, 0.6, 128, 128, 'velocity') / (4 * PI);
    notes.push(`β ${beta}: |flux/4πq − 1| ≤ ${worst.toExponential(1)} (velocity part alone: ${fv.toFixed(3)})`);
  }
  // The smooth stop stored as the demo stores paths (sampled 240 times a second, quintics
  // between): just as exact.
  const smooth = smoothStop(0.7, 0.1), S = new Trajectory(1 / 240);
  prefill(S, { at: (t, o) => { smooth.at(t); o.set([smooth.wx, smooth.wy, smooth.vx, smooth.vy, smooth.ax, smooth.ay]); } }, 0.4, 0, 30, c);
  const fsm = flux(new LW(S, c), 0.4, 0.2, 0.1, 0.05, 0.6, 128, 128) / (4 * PI) - 1;
  assert(Math.abs(fsm) < 1e-9, `sampled smooth stop: ${fsm}`);
  notes.push(`sampled: ${fsm.toExponential(1)}`);
  // The demo's own stop: its acceleration has corners (where it starts and ends), so the
  // quadrature converges more slowly, but to the same answer.
  const { motion } = presetPath('stop', { beta: 0.7, tau: 0.2 }, c);
  const T = new Trajectory(1 / 240), t = motion.end + 0.3;
  prefill(T, motion, t, 0, 30, c);
  const ls = new LW(T, c), errs = [];
  for (const n of [64, 128, 256, 512]) errs.push(Math.abs(flux(ls, t, 0.2, 0.1, 0.05, 0.6, n, n) / (4 * PI) - 1));
  assert(errs[3] < 3e-6 && errs[3] < errs[1] / 8, `sampled stop: errors ${errs}`);
  notes.push(`the demo's sampled stop: ${errs.map((e) => e.toExponential(1)).join(', ')} with 64, 128, 256, 512 points a side`);
  return notes.join('; ');
});

test('radiation: dP/dΩ integrates to Liénard\'s power; Larmor for slow charges', () => {
  const c = 2, { x: mu, w } = gaussLegendre(160);
  const cases = [[0, 0, 1, 0], [0.5, 0, 1, 0], [0.5, 0, 0, 1], [0.9, 0.3, -0.4, 1.1], [-0.2, 0.95, 2, -0.3], [0.001, 0, 0.3, 0.4]];
  for (const [bx, by, ax, ay] of cases) {
    const vx = bx * c, vy = by * c, nph = 512;
    let s = 0;
    for (let i = 0; i < mu.length; i++) {
      const st = Math.sqrt(1 - mu[i] * mu[i]);
      for (let j = 0; j < nph; j++) {
        const ph = (2 * PI * j) / nph;
        s += w[i] * (2 * PI / nph) * dPdOmega(st * Math.cos(ph), st * Math.sin(ph), mu[i], vx, vy, ax, ay, c);
      }
    }
    const P = lienardPower(vx, vy, ax, ay, c);
    close(s / P, 1, 1e-5, `β = (${bx}, ${by}):`);
  }
  // Slow: Liénard = Larmor.  Fast: γ⁶ for a along v, γ⁴ for a across v.
  close(lienardPower(1e-4, 0, 1, 0, 1) / larmorPower(1, 0, 1), 1, 1e-7);
  const b = 0.8, g = 1 / Math.sqrt(1 - b * b);
  close(lienardPower(b, 0, 1, 0, 1) / larmorPower(1, 0, 1), g ** 6, 1e-12);
  close(lienardPower(b, 0, 0, 1, 1) / larmorPower(0, 1, 1), g ** 4, 1e-12);
});

test('radiation: energy through a large sphere (Poynting flux) = ∫ Liénard power dt', () => {
  // From rest to β = 0.5 in one second along x (c = 1), then coasting.
  const c = 1, v0 = 0.5, tau = 1;
  const S = (u) => u * u * (3 - 2 * u), dS = (u) => 6 * u * (1 - u), IS = (u) => u * u * u * (1 - u / 2);
  const path = new AnalyticPath((t, o) => {
    const u = Math.min(1, Math.max(0, t / tau));
    o[0] = t <= 0 ? 0 : t >= tau ? v0 * tau / 2 + v0 * (t - tau) : v0 * tau * IS(u);
    o[1] = 0; o[2] = v0 * S(u); o[3] = 0; o[4] = t > 0 && t < tau ? v0 * dS(u) / tau : 0; o[5] = 0;
  });
  // Liénard, integrated over the charge's time.
  const G = gaussLegendre(64);
  let W = 0;
  for (let i = 0; i < 64; i++) {
    const t = tau * (G.x[i] + 1) / 2;
    path.at(t);
    W += G.w[i] * tau / 2 * lienardPower(path.vx, path.vy, path.ax, path.ay, c);
  }
  // Poynting: ∫dt ∮ (c/4π)(E×B)·dA over a sphere of radius Rs about the origin.  For each
  // direction, the time integral is done in the retarded time: dt = κ dt_r.
  const lw = new LW(path, c), A = gaussLegendre(48), T = gaussLegendre(48), nph = 48;
  const results = [];
  for (const Rs of [1e3, 1e5]) {
    let sum = 0;
    for (let i = 0; i < A.x.length; i++) {
      const st = Math.sqrt(1 - A.x[i] ** 2);
      for (let j = 0; j < nph; j++) {
        const ph = (2 * PI * (j + 0.5)) / nph, nx = st * Math.cos(ph), ny = st * Math.sin(ph), nz = A.x[i];
        const x = Rs * nx, y = Rs * ny, z = Rs * nz;
        let inner = 0;
        for (let k = 0; k < T.x.length; k++) {
          const trr = tau * (T.x[k] + 1) / 2;
          path.at(trr);
          const R = Math.hypot(x - path.wx, y - path.wy, z), t = trr + R / c;
          lw.field(x, y, z, t);
          const B = lw.bfield();
          const Sr = (c / (4 * PI)) * ((lw.ey * B[2] - lw.ez * B[1]) * nx + (lw.ez * B[0] - lw.ex * B[2]) * ny + (lw.ex * B[1] - lw.ey * B[0]) * nz);
          inner += T.w[k] * tau / 2 * Sr * lw.kappa;
        }
        sum += A.w[i] * (2 * PI / nph) * Rs * Rs * inner;
      }
    }
    results.push([Rs, sum]);
  }
  const [[R1, W1], [R2, W2]] = results;
  close(W2 / W, 1, 2e-5, `Rs = ${R2}:`);
  // The difference at finite radius is the 1/R cross term of the velocity and radiation fields.
  assert(Math.abs(W1 / W - 1) < 2e-3, `Rs = ${R1}: ${W1 / W}`);
  return `∫P dt = ${W.toFixed(6)}; flux at R = 1e3: ${W1.toFixed(6)}, at 1e5: ${W2.toFixed(6)}`;
});

test('radiation: far away, the Poynting flux per unit retarded time is dP/dΩ', () => {
  const c = 1;
  const { path } = presetPath('circle', { beta: 0.8, radius: 1 }, c);
  const lw = new LW(path, c), Rf = 1e6;
  for (const ph of [0, 0.4, 1.3, 2.9, 4.4]) {
    for (const th of [PI / 2, 1.1]) {
      const nx = Math.sin(th) * Math.cos(ph), ny = Math.sin(th) * Math.sin(ph), nz = Math.cos(th);
      const tr0 = 0.77;
      path.at(tr0);
      const x = path.wx + Rf * nx, y = path.wy + Rf * ny, z = Rf * nz, t = tr0 + Rf / c;
      lw.field(x, y, z, t);
      close(lw.tr, tr0, 1e-6);
      const B = lw.bfield();
      const Sn = (c / (4 * PI)) * ((lw.ey * B[2] - lw.ez * B[1]) * lw.nx + (lw.ez * B[0] - lw.ex * B[2]) * lw.ny + (lw.ex * B[1] - lw.ey * B[0]) * lw.nz);
      const dP = dPdOmega(lw.nx, lw.ny, lw.nz, path.vx, path.vy, path.ax, path.ay, c);
      close(Sn * lw.R * lw.R * lw.kappa / dP, 1, 1e-4, `direction ${th}, ${ph}:`);
    }
  }
});

test('radiation: after a stop, the old field outside the shell, the new one inside', () => {
  const c = 4;
  const { motion, path } = presetPath('stop', { beta: 0.8, tau: 0.1 }, c);
  const ts = motion.end - 0.1, t = motion.end + 1.5;     // the shell is between 6 and 6.4 + ... from the stop
  const lw = new LW(path, c), v0 = 0.8 * c;
  path.at(ts);
  const xext = path.wx + v0 * (t - ts);                     // where it would be had it not stopped
  // Inside: Coulomb, centred on the stopped charge.
  lw.field(2, 3, 0, t);
  let r = Math.hypot(2, 3);
  close(lw.ex, 2 / r ** 3, 1e-12); close(lw.ey, 3 / r ** 3, 1e-12);
  // Outside: Heaviside, centred on the extrapolated position.
  for (const [x, y] of [[-12, 5], [20, -3], [3, 14]]) {
    lw.field(x, y, 0, t);
    const rx = x - xext, ry = y; r = Math.hypot(rx, ry);
    const g2 = 1 / (1 - 0.64), sin2 = (ry / r) ** 2, f = (1 / g2) / (r ** 3 * (1 - 0.64 * sin2) ** 1.5);
    close(lw.ex / (f * rx), 1, 1e-9); close(lw.ey / (f * ry), 1, 1e-9);
  }
  // In the shell the field is mostly transverse, and it falls off as 1/R, not 1/R².
  const shell = (R) => { let best = 0; for (let k = 0; k < 400; k++) { lw.field(0, R + k * 0.005 - 1, 0, ts + 0.05 + R / c); best = Math.max(best, Math.hypot(lw.eax, lw.eay)); } return best; };
  const e1 = shell(4), e2 = shell(8);
  close(e1 / e2, 2, 0.1, 'the peak transverse field from 4 to 8 units:');
});

test('radiation: field lines leave a uniformly moving charge straight, contracted along v', () => {
  const c = 2;
  for (const beta of [0, 0.5, 0.95]) {
    const T = new Trajectory();
    T.reset(0, 0.5, -0.5, beta * c * 0.6, beta * c * 0.8);
    const lw = new LW(T, c);
    const { lines } = fieldLines(lw, 0, 'total', 16, [-10, 10, -8, 8]);
    let worst = 0;
    lines.forEach((L, k) => {
      const [dx, dy] = seedDirection((2 * PI * (k + 0.5)) / 16, T.vx, T.vy, c);
      for (let i = 2; i < L.length; i += 2) {
        const rx = L[i] - 0.5, ry = L[i + 1] + 0.5, r = Math.hypot(rx, ry);
        worst = Math.max(worst, Math.abs(rx * dy - ry * dx) / r);
      }
      // It reaches the edge of the box.
      const xe = L[L.length - 2], ye = L[L.length - 1];
      assert(Math.abs(xe) > 9.5 || Math.abs(ye) > 7.5, `line ${k} ends at ${xe}, ${ye}`);
    });
    assert(worst < 1e-6, `beta ${beta}: lines bend by ${worst}`);
  }
  // tan θ = γ tan θ₀: the line at 45° in the rest frame.
  const b = 0.8, g = 1 / Math.sqrt(1 - b * b), [dx, dy] = seedDirection(PI / 4, b, 0, 1);
  close(dy / dx, g, 1e-12);
});

test('radiation: the field lines follow the kink of a sudden stop', () => {
  const c = 4;
  const { motion } = presetPath('stop', { beta: 0.8, tau: 0.15 }, c);
  const t = motion.end + 1.2;
  const T = new Trajectory();
  prefill(T, motion, t, 0, 20, c);
  const lw = new LW(T, c);
  const { lines, evaluations } = fieldLines(lw, t, 'total', 24, [-16, 16, -10, 10]);
  // A line that leaves at 90° in the rest frame (straight up): radial (vertical) inside the
  // shell; outside, it must point away from the extrapolated position, so it has moved
  // sideways along the shell.  Count its points inside, in, and beyond the shell.
  const up = lines[5];   // seeds at (k + 1/2) 15°: k = 5 is 82.5°
  let inside = 0, beyond = 0, maxSide = 0;
  for (let i = 0; i < up.length; i += 2) {
    const r = Math.hypot(up[i], up[i + 1]);
    if (r < 4) { inside++; maxSide = Math.max(maxSide, Math.abs(up[i] - up[i + 1] * Math.tan(PI / 2 - 82.5 * PI / 180))); }
    if (r > 6) beyond++;
  }
  assert(inside > 2 && beyond > 2, `points inside ${inside}, beyond ${beyond}`);
  assert(maxSide < 1e-3, `inside the shell the line is radial from the stopped charge (off by ${maxSide})`);
  // Beyond the shell, on the way out, it is radial from where the charge would have been.
  const xext = 0.8 * c * (1.2 + 0.15 / 2);
  const i = up.length - 4, rx = up[i] - xext, ry = up[i + 1];
  T.at(t);
  lw.field(up[i], up[i + 1], 0, t);
  const cross = Math.abs(rx * lw.ey - ry * lw.ex) / (Math.hypot(rx, ry) * Math.hypot(lw.ex, lw.ey));
  assert(cross < 1e-6, `beyond the shell the field points from the extrapolated position (${cross})`);
  return `${evaluations} field evaluations for 24 lines`;
});

test('radiation: the follower keeps β < 0.98, and a hand at 60 Hz makes a smooth acceleration', () => {
  const c = 8, F = new Follower(), h = 1 / 240;
  // Wild input: the target jumps about at random, 60 times a second.
  F.start(0, 0, 0, 0, c);
  let seed = 1;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  let tx = 0, ty = 0, bmax = 0;
  for (let k = 0; k < 240 * 20; k++) {
    if (k % 4 === 0) { tx = Math.max(-15, Math.min(15, tx + (rnd() - 0.5) * 6)); ty = Math.max(-10, Math.min(10, ty + (rnd() - 0.5) * 6)); }
    F.step(h, tx, ty, c);
    bmax = Math.max(bmax, Math.hypot(F.vx, F.vy) / c);
    assert(Number.isFinite(F.ax) && Number.isFinite(F.ay), 'finite acceleration');
  }
  assert(bmax < BETA_MAX, `beta reached ${bmax}`);
  // A hand going round a circle (radius 4, once in 2π s: β = 0.5), reported at 60 Hz with
  // ±3 ms of jitter in the timing.  The charge's acceleration should be the steady
  // centripetal one, without a 60 Hz ripple.
  const pp = new PointerPath(), tgt = [0, 0];
  F.start(4, 0, 0, 4, c);
  let next = 0, amin = Infinity, amax = 0, sum = 0, n = 0;
  for (let k = 0; k < 240 * 8; k++) {
    const t = k * h;
    while (next <= t) { const te = next + 0.003 * (rnd() - 0.5) * 2; pp.add(te, 4 * Math.cos(te), 4 * Math.sin(te)); next += 1 / 60; }
    pp.at(t, tgt);
    F.step(h, tgt[0], tgt[1], c);
    if (t > 2) { const a = Math.hypot(F.ax, F.ay); amin = Math.min(amin, a); amax = Math.max(amax, a); sum += a; n++; }
  }
  const mean = sum / n;
  close(mean, 4, 0.2, 'the centripetal acceleration:');
  assert((amax - amin) / mean < 0.1, `ripple ${(amax - amin) / mean}`);
  // Let go: it comes to rest at the target without overshooting.
  F.start(0, 0, 0, 0, c);
  let xmax = 0;
  for (let k = 0; k < 240 * 3; k++) { F.step(h, 5, 0, c); xmax = Math.max(xmax, F.x); }
  close(F.x, 5, 1e-4); close(F.vx, 0, 1e-3);
  assert(xmax <= 5 + 1e-9, `overshoot ${xmax - 5}`);
  return `β max ${bmax.toFixed(3)} for wild input; ripple ${((amax - amin) / mean * 100).toFixed(1)}% of |a| for a hand at 60 Hz`;
});

test('radiation: the presets\' velocities and accelerations are the derivatives of their paths', () => {
  const c = 8, o = new Float64Array(6), p = new Float64Array(6), m = new Float64Array(6), d = 1e-5;
  for (const [name, preset] of Object.entries(PRESETS)) {
    const P = Object.fromEntries(Object.entries(preset.params).map(([k, q]) => [k, q.value]));
    const fast = { ...P };
    if (fast.beta !== undefined) fast.beta = preset.params.beta.max;
    for (const params of [P, fast]) {
      const mo = preset.make(params, c);
      let bmax = 0;
      for (let t = -3.0123; t < 12; t += 0.0137) {
        mo.at(t, o); mo.at(t + d, p); mo.at(t - d, m);
        for (let k = 0; k < 4; k++) {
          const num = (p[k] - m[k]) / (2 * d), scale = 1 + Math.abs(o[k + 2]);
          assert(Math.abs(num - o[k + 2]) < 1e-5 * scale * 10, `${name} t=${t.toFixed(3)} component ${k}: ${num} vs ${o[k + 2]}`);
        }
        bmax = Math.max(bmax, Math.hypot(o[2], o[3]) / c);
      }
      assert(bmax <= BETA_MAX + 1e-12, `${name}: beta ${bmax}`);
    }
  }
});

test('radiation: a typed path is differentiated accurately', () => {
  const fx = (ts) => Float64Array.from(ts, (t) => 2 * Math.cos(1.5 * t));
  const fy = (ts) => Float64Array.from(ts, (t) => Math.sin(3 * t) + 0.1 * t * t);
  const mo = typedMotion(fx, fy), o = new Float64Array(6);
  for (const t of [-2, 0, 0.3, 1.7]) {
    mo.at(t, o);
    close(o[2], -3 * Math.sin(1.5 * t), 1e-6); close(o[3], 3 * Math.cos(3 * t) + 0.2 * t, 1e-6);
    close(o[4], -4.5 * Math.cos(1.5 * t), 1e-5); close(o[5], -9 * Math.sin(3 * t) + 0.2, 1e-5);
  }
});
