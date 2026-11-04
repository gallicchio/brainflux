// The Bloch equations for a magnetization vector M in a magnetic field B,
//
//   dM/dt = γ M × B − (Mx x̂ + My ŷ)/T2 − (Mz − M0) ẑ/T1,
//
// with γ/2π = 42.577 MHz/T for protons.  M is a plain array [x, y, z] in units of the
// equilibrium magnetization (M0 = 1); B is in tesla; times are in seconds.  Nothing here touches
// the page, so the tests can exercise it.
//
// How it is integrated.  In a field that does not change, the precession is exactly a rotation of
// M about B̂ by the angle −γ|B| dt, and the relaxation is exactly an exponential, so a step is
// "relax half a step, rotate, relax half a step": exact when the two commute (B along ẑ), second
// order otherwise.  A field that changes in time (the switch-off of the polarizing field) is
// stepped with the field at the middle of each step, with steps much shorter than the Larmor
// period in the field of the moment.
//
// Conventions.  With γ > 0, M × B turns M about B in the left-handed sense: seen from the tip of
// B, M goes round clockwise, i.e. by the angle −γ|B| dt about B̂ in the right-hand sense.  A pulse
// "about x" has B1 along +x′ in the rotating frame and takes ẑ towards +ŷ′.  The rotating frame
// turns with the precession, clockwise about ẑ at ω_ref: x̂′ = (cos ω_ref t, −sin ω_ref t, 0).

export const GAMMA_HZ = 42.577e6;              // γ/2π in Hz/T (protons)
export const GAMMA = 2 * Math.PI * GAMMA_HZ;   // γ in rad/s/T

/** Rotate v in place about the unit vector k by the angle a (right-hand sense: Rodrigues). */
export function rotate(v, k, a) {
  const c = Math.cos(a), s = Math.sin(a), x = v[0], y = v[1], z = v[2], kx = k[0], ky = k[1], kz = k[2];
  const d = (kx * x + ky * y + kz * z) * (1 - c);
  v[0] = x * c + (ky * z - kz * y) * s + kx * d;
  v[1] = y * c + (kz * x - kx * z) * s + ky * d;
  v[2] = z * c + (kx * y - ky * x) * s + kz * d;
  return v;
}

/** Precess M in place about the field B (tesla) for dt: a rotation by −γ|B| dt about B̂. */
export function precess(M, B, dt) {
  const b = Math.hypot(B[0], B[1], B[2]);
  if (b === 0) return M;
  return rotate(M, [B[0] / b, B[1] / b, B[2] / b], -GAMMA * b * dt);
}

/**
 * Relax M in place for dt: its part along the axis n (ẑ when n is null) goes towards Meq with
 * T1, the rest decays with T2.  Infinity means no relaxation.
 */
export function relax(M, dt, T1, T2, Meq = 1, n = null) {
  const e2 = T2 === Infinity ? 1 : Math.exp(-dt / T2);
  const e1 = T1 === Infinity ? 1 : Math.exp(-dt / T1);
  if (!n) { M[0] *= e2; M[1] *= e2; M[2] = Meq + (M[2] - Meq) * e1; return M; }
  const p = M[0] * n[0] + M[1] * n[1] + M[2] * n[2];
  const q = Meq + (p - Meq) * e1;
  for (let i = 0; i < 3; i++) M[i] = (M[i] - p * n[i]) * e2 + q * n[i];
  return M;
}

/** One step of dt in a constant field B with relaxation about ẑ (or about the axis n). */
export function blochStep(M, B, dt, T1 = Infinity, T2 = Infinity, Meq = 1, n = null) {
  relax(M, dt / 2, T1, T2, Meq, n);
  precess(M, B, dt);
  relax(M, dt / 2, T1, T2, Meq, n);
  return M;
}

/**
 * Integrate M from t0 to t1 in a field B(t) (a function of t returning [Bx, By, Bz] in tesla)
 * that may change in time.  Each step rotates M about the field at the step's middle, with steps
 * of at most 1/perPeriod of the Larmor period in the field of the moment (and at most dtMax).
 * axis: 'z' relaxes about ẑ towards M0; 'field' relaxes about the field's own direction towards
 * M0 |B|/Bref, as the protons do while the polarizing field dominates.  onStep(t, M) is called
 * after every step.  Returns M.
 */
export function integrate(M, Bof, t0, t1, { T1 = Infinity, T2 = Infinity, M0 = 1, axis = 'z', Bref = 1, perPeriod = 32, dtMax = Infinity, onStep = null } = {}) {
  let t = t0;
  while (t < t1) {
    const Bn = Bof(t), bn = Math.hypot(Bn[0], Bn[1], Bn[2]);
    const dt = Math.min(dtMax, t1 - t, bn > 0 ? (2 * Math.PI) / (GAMMA * bn * perPeriod) : Infinity);
    const Bm = Bof(t + dt / 2), b = Math.hypot(Bm[0], Bm[1], Bm[2]);
    const n = axis === 'field' && b > 0 ? [Bm[0] / b, Bm[1] / b, Bm[2] / b] : null;
    const Meq = axis === 'field' ? (M0 * b) / Bref : M0;
    relax(M, dt / 2, T1, T2, Meq, n);
    precess(M, Bm, dt);
    relax(M, dt / 2, T1, T2, Meq, n);
    t += dt;
    onStep?.(t, M);
  }
  return M;
}

// ------------------------------------------------------------------- pulses and frames

/**
 * The field during an RF pulse, in the frame rotating at the RF frequency: B1 in the transverse
 * plane at the phase φ (0: along x′), and along z what is left of B0 once the frame has taken
 * ω_rf/γ of it, ΔB = B0 − ω_rf/γ = −2π δf/γ for an RF δf above the Larmor frequency.
 */
export function effectiveField(B1, phase, offsetHz) {
  return [B1 * Math.cos(phase), B1 * Math.sin(phase), -(2 * Math.PI * offsetHz) / GAMMA];
}

/** How long a pulse of B1 takes to turn M by `angle` (radians) on resonance: τ = θ/γB1. */
export function pulseDuration(angle, B1) { return angle / (GAMMA * B1); }

/** The B1 that turns M by `angle` in the time tau. */
export function pulseField(angle, tau) { return angle / (GAMMA * tau); }

/**
 * Apply a pulse to M at once (no relaxation): a rotation about the effective field by
 * −γ|B_eff| τ, with τ the duration of the pulse on resonance, so that off resonance M turns
 * about a tilted axis by a larger angle, and the nominal flip fails.
 */
export function pulse(M, angle, phase, B1, offsetHz = 0) {
  const tau = pulseDuration(angle, B1);
  return precess(M, effectiveField(B1, phase, offsetHz), tau);
}

/** The lab-frame vector of a rotating-frame one at time t: the frame turns clockwise at ω_ref. */
export function toLab(Mrot, omegaRef, t, out = [0, 0, 0]) {
  const a = -omegaRef * t, c = Math.cos(a), s = Math.sin(a), x = Mrot[0], y = Mrot[1];
  out[0] = x * c - y * s;
  out[1] = x * s + y * c;
  out[2] = Mrot[2];
  return out;
}

/** The rotating-frame vector of a lab-frame one at time t. */
export function toRotating(Mlab, omegaRef, t, out = [0, 0, 0]) { return toLab(Mlab, -omegaRef, t, out); }

// --------------------------------------------------------------------------- spin ½

/**
 * The spin-½ state whose ⟨S⟩ points along M: cos(θ/2)|↑⟩ + e^{iφ} sin(θ/2)|↓⟩, with θ, φ the
 * polar angles of M.  A pure state has |M| = 1; a shorter M is an ensemble whose spins have
 * lost step (a mixed state), and the angles are then those of M's direction.
 */
export function spinHalf(M) {
  const r = Math.hypot(M[0], M[1], M[2]);
  const theta = r > 0 ? Math.acos(Math.max(-1, Math.min(1, M[2] / r))) : 0;
  const phi = r > 0 ? Math.atan2(M[1], M[0]) : 0;
  const up = Math.cos(theta / 2), down = Math.sin(theta / 2);
  return { theta, phi, up, down, pUp: up * up, length: r };
}

// ------------------------------------------------------------------- an ensemble of spins

/**
 * N Larmor-frequency offsets (rad/s) spread as a Lorentzian line of full width fwhmHz at half
 * maximum, taken at the quantiles (i + ½)/N (not drawn at random), so that the sum of the N
 * spins reproduces the line: its free induction decays as e^{−t/T2′} with T2′ = 1/(π fwhmHz).
 */
export function lorentzianOffsets(N, fwhmHz) {
  const G = Math.PI * fwhmHz;   // the half width at half maximum in rad/s, = 1/T2′
  const out = new Float64Array(N);
  for (let i = 0; i < N; i++) out[i] = N === 1 ? 0 : G * Math.tan(Math.PI * ((i + 0.5) / N - 0.5));
  return out;
}

/** The decay time of a free induction from a spread of full width fwhmHz: 1/(π Δf). */
export function spreadT2(fwhmHz) { return fwhmHz > 0 ? 1 / (Math.PI * fwhmHz) : Infinity; }

/** 1/T2* = 1/T2 + 1/T2′: the time the FID of the ensemble takes to fall by 1/e. */
export function T2star(T2, fwhmHz) {
  const r = (T2 === Infinity ? 0 : 1 / T2) + (fwhmHz > 0 ? Math.PI * fwhmHz : 0);
  return r > 0 ? 1 / r : Infinity;
}

/**
 * N spins in the rotating frame, each with its own Larmor offset δω_i (rad/s, relative to the
 * frame's ω_ref), all seeing the same B1 and the same RF offset, each relaxing with T1 and T2.
 */
export class Ensemble {
  constructor(offsets) {
    this.offsets = offsets instanceof Float64Array ? offsets : Float64Array.from(offsets);
    this.N = this.offsets.length;
    this.M = new Float64Array(3 * this.N);
    this.set([0, 0, 1]);
  }

  /** Point every spin along v. */
  set(v) {
    for (let i = 0; i < this.N; i++) { this.M[3 * i] = v[0]; this.M[3 * i + 1] = v[1]; this.M[3 * i + 2] = v[2]; }
    return this;
  }

  /** Spin i as a vector. */
  get(i, out = [0, 0, 0]) { out[0] = this.M[3 * i]; out[1] = this.M[3 * i + 1]; out[2] = this.M[3 * i + 2]; return out; }

  /** The mean of the N spins: the magnetization that the coil sees. */
  sum(out = [0, 0, 0]) {
    let x = 0, y = 0, z = 0;
    for (let i = 0, k = 0; i < this.N; i++, k += 3) { x += this.M[k]; y += this.M[k + 1]; z += this.M[k + 2]; }
    out[0] = x / this.N; out[1] = y / this.N; out[2] = z / this.N;
    return out;
  }

  /**
   * Advance every spin by dt in the rotating frame.  Beff is the field common to all (tesla,
   * [Bx, By, Bz]: B1 and the RF offset's ΔB); each spin adds its own offset along z.  Exact for
   * any dt while Beff has no transverse part; during a pulse the relaxation is split about it.
   */
  step(dt, Beff, T1 = Infinity, T2 = Infinity, M0 = 1) {
    const N = this.N, M = this.M, off = this.offsets;
    const e2 = T2 === Infinity ? 1 : Math.exp(-dt / (2 * T2)), e1 = T1 === Infinity ? 1 : Math.exp(-dt / (2 * T1));
    const bx = Beff[0], by = Beff[1], bz0 = Beff[2];
    const transverse = bx !== 0 || by !== 0;
    for (let i = 0, k = 0; i < N; i++, k += 3) {
      let x = M[k] * e2, y = M[k + 1] * e2, z = M0 + (M[k + 2] - M0) * e1;
      const bz = bz0 + off[i] / GAMMA;
      if (!transverse) {
        // A rotation about ẑ by −γ bz dt = −(ΔΩ + δω_i) dt.
        const a = -GAMMA * bz * dt, c = Math.cos(a), s = Math.sin(a);
        const nx = x * c - y * s, ny = x * s + y * c;
        x = nx; y = ny;
      } else {
        const b = Math.hypot(bx, by, bz);
        const kx = bx / b, ky = by / b, kz = bz / b, a = -GAMMA * b * dt, c = Math.cos(a), s = Math.sin(a);
        const d = (kx * x + ky * y + kz * z) * (1 - c);
        const nx = x * c + (ky * z - kz * y) * s + kx * d;
        const ny = y * c + (kz * x - kx * z) * s + ky * d;
        const nz = z * c + (kx * y - ky * x) * s + kz * d;
        x = nx; y = ny; z = nz;
      }
      M[k] = x * e2; M[k + 1] = y * e2; M[k + 2] = M0 + (z - M0) * e1;
    }
    return this;
  }
}

// ------------------------------------------------------------------- the Earth's field board
//
// The coil's axis n̂ lies at the angle α to the Earth's field BE (along ẑ), in the x–z plane:
// n̂ = (sin α, 0, cos α).  α = 90° (the default) is the board's coil laid east–west, square to
// the field.  The polarizing field Bp is along n̂.

/** The coil's axis at the angle `angle` (radians) to the Earth's field ẑ. */
export function coilAxis(angle = Math.PI / 2) { return [Math.sin(angle), 0, Math.cos(angle)]; }

/**
 * The adiabaticity of a linear ramp of the polarizing field Bp (along the coil's axis, at the
 * angle α to the Earth's field BE) down to zero in the time tau.  The total field swings from the
 * coil's axis to the Earth's; it turns fastest at the end of the ramp, through its last radian in
 * the time τ BE/(Bp sin α).  Against the Larmor period in the Earth's field that is
 *   A = γ BE² τ / (Bp sin α):
 * A ≪ 1 is sudden (M is left where it was, across the Earth's field, and rings), A ≫ 1 is
 * adiabatic (M follows the field down to ẑ and nothing rings).
 */
export function adiabaticity(Bp, BE, tau, angle = Math.PI / 2) { return (GAMMA * BE * BE * tau) / (Bp * Math.max(1e-9, Math.sin(angle))); }

/** The total field during the switch-off: Bp ramping linearly to zero in tau along the coil's
 *  axis (at `angle` to ẑ: x̂ by default), BE along ẑ. */
export function rampField(Bp, BE, tau, t, angle = Math.PI / 2) {
  const s = tau > 0 ? Math.max(0, 1 - t / tau) : 0;
  return [Bp * s * Math.sin(angle), 0, BE + Bp * s * Math.cos(angle)];
}

/**
 * Switch the polarizing field off: integrate M (lab frame, starting at t = 0 of the ramp)
 * (64 steps a Larmor period: with the field's axis turning under it, 16 leave 1% of error at
 * A = 1, 64 under 0.05%)
 * through the linear ramp of Bp to zero in tau, in the Earth's field BE, relaxing about the
 * field of the moment towards the equilibrium of that field (M0E |B|/BE, with M0E the
 * equilibrium in the Earth's field alone, in the units of M).  Returns M at the end of the ramp.
 */
export function switchOff(M, Bp, BE, tau, { T1 = Infinity, T2 = Infinity, M0E = 0, perPeriod = 64, onStep = null, angle = Math.PI / 2 } = {}) {
  if (tau <= 0) return M;
  return integrate(M, (t) => rampField(Bp, BE, tau, t, angle), 0, tau, { T1, T2, M0: M0E, axis: 'field', Bref: BE, perPeriod, dtMax: tau / 200, onStep });
}

/**
 * The magnetization built along the polarizing field by polarizing for tp with a field Bp along
 * the coil's axis (at `angle` to the Earth's field BE, square to it by default), in units of the
 * equilibrium in the total field: 1 − e^{−tp/T1} (the equilibrium in the Earth's field alone,
 * about BE/Bp of it, is where it starts).
 */
export function polarized(tp, T1, Bp, BE, angle = Math.PI / 2) {
  // It starts at the equilibrium of the Earth's field alone, BE/|B| along ẑ, of which only the
  // part along the total field, BE (BE + Bp cos α)/|B|² of M_p, counts for T1.
  const Bz = BE + Bp * Math.cos(angle), B2 = (Bp * Math.sin(angle)) ** 2 + Bz * Bz;
  const m0 = (BE * Bz) / B2;
  return T1 === Infinity ? m0 : 1 - (1 - m0) * Math.exp(-tp / T1);
}
