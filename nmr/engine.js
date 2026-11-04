// The running experiment: a clock, the spins, the pulses sent in (now, or at set times), the
// record of what the coil sees, and the Earth's-field board's polarize-and-listen cycle.  The
// page calls advance(dt) once a frame and draws what it finds; the tests and the batch runs
// (sequence.js) call it with no page at all.
//
// The spins are integrated in the frame rotating at the reference frequency ω_ref (the RF, or
// the board's mixer: ω_ref = γ B0 + 2π δf), where the field is static between the ends of a
// pulse, so every step is an exact rotation whatever its length.  The lab-frame vectors are made
// from the rotating-frame ones when asked for.  The board's polarizing and switch-off are
// integrated in the lab frame on one vector (all the spins see the same field then), which is
// handed to the ensemble when the listening starts.

import { GAMMA, Ensemble, lorentzianOffsets, effectiveField, pulseDuration, integrate, toRotating, toLab, blochStep, rampField } from './bloch.js';
import { Record, Rng } from './signal.js';

const DEG = Math.PI / 180;

export class Engine {
  constructor(params = {}) {
    this.p = {
      B0: 5e6 / 42.577e6,     // tesla
      B1: 2.3487e-3,          // tesla: a π/2 pulse in 2.5 μs
      offsetHz: 0,            // the RF (reference) frequency minus the Larmor frequency
      T1: Infinity, T2: Infinity,
      N: 1, spreadHz: 0,      // spins, and the full width of their Larmor-frequency spread
      averages: 1,            // repeats averaged (the noise falls as 1/√averages)
      ...params,
    };
    this.t = 0;
    this.tEnd = Infinity;     // the sequence's end, if it has one
    this.done = false;
    this.record = new Record();
    this.rng = new Rng(7);
    this.dtSample = 1e-6;
    this.nextSample = 0; this.kSample = 0;
    this.pulse = null;        // the pulse on now
    this.queue = [];          // pulses to come, sorted by time
    this.sent = [];           // pulses sent so far (for the charts), {t0, t1, angle, phase}
    this.mode = 'nmr';
    this.earth = null;
    this.ens = new Ensemble(lorentzianOffsets(this.p.N, this.p.spreadHz));
    this._v = [0, 0, 0];
  }

  /** The reference frequency: the RF's, or the mixer's, in rad/s. */
  get omegaRef() {
    const B = this.mode === 'earth' ? this.earth.BE : this.p.B0;
    return GAMMA * B + 2 * Math.PI * this.p.offsetHz;
  }

  /** The Larmor frequency of the spins at the centre of the spread, in Hz. */
  get f0() { return (GAMMA / (2 * Math.PI)) * (this.mode === 'earth' ? this.earth.BE : this.p.B0); }

  /** Change parameters.  A new number of spins or spread rebuilds the ensemble, every spin set
   *  to the present mean (the fan closes; the pulses and the record are kept). */
  configure(changes) {
    const was = { N: this.p.N, spreadHz: this.p.spreadHz, averages: this.p.averages };
    Object.assign(this.p, changes);
    if (this.p.N !== was.N || this.p.spreadHz !== was.spreadHz) {
      const m = this.ens.sum();
      this.ens = new Ensemble(lorentzianOffsets(this.p.N, this.p.spreadHz));
      this.ens.set(m);
    }
    if (this.p.averages !== was.averages) this.record.renoise(this.rng, this.p.averages);
    return this;
  }

  /** How often the record samples the magnetization. */
  setSampling(dt) {
    if (dt === this.dtSample) return;
    this.dtSample = dt;
    this._grid();
  }

  /** The next sample on the grid k dt (anchored at t = 0, so a sample falls on every multiple of
   *  dt: an echo at 2τ is sampled at its peak), after the clock. */
  _grid() {
    const dt = this.dtSample;
    this.kSample = Number.isFinite(dt) ? Math.floor(this.t / dt + 1e-9) + 1 : 1;
    this.nextSample = Number.isFinite(dt) ? this.kSample * dt : Infinity;
  }

  /** Start afresh: every spin along M (rotating frame), the clock at t, nothing sent, no record. */
  reset(M = [0, 0, 1], t = 0) {
    this.mode = 'nmr'; this.earth = null;
    this.t = t; this.tEnd = Infinity; this.done = false;
    this.ens.set(M);
    this.record.clear();
    this.pulse = null; this.queue = []; this.sent = [];
    this.sample();
    this._grid();
    return this;
  }

  /** Point every spin along v (given in the frame asked for), now. */
  setVector(v, frame = 'rot') {
    const m = frame === 'lab' ? toRotating(v, this.omegaRef, this.t) : v;
    if (this.earth && this.earth.phase !== 'listen') this.earth.M = frame === 'lab' ? [...v] : toLab(v, this.omegaRef, this.t);
    else this.ens.set(m);
  }

  // ----------------------------------------------------------------------------- pulses

  /** Send a pulse now (after any pulse already on or waiting).  angle, phase in degrees. */
  pulseNow(angle, phase, B1 = this.p.B1) {
    let t = this.t;
    if (this.pulse) t = Math.max(t, this.pulse.t1);
    for (const q of this.queue) t = Math.max(t, q.t + pulseDuration(q.angle * DEG, q.B1));
    return this.schedule(t, angle, phase, B1);
  }

  /** Send a pulse at the time t of the clock. */
  schedule(t, angle, phase, B1 = this.p.B1) {
    const q = { t, angle, phase, B1 };
    this.queue.push(q);
    this.queue.sort((a, b) => a.t - b.t);
    return q;
  }

  _start(q) {
    const dur = pulseDuration(q.angle * DEG, q.B1);
    this.pulse = { ...q, t0: this.t, t1: this.t + dur, dur, Beff: effectiveField(q.B1, q.phase * DEG, this.p.offsetHz) };
    this.sent.push({ t0: this.t, t1: this.t + dur, angle: q.angle, phase: q.phase });
  }

  /** The field in the rotating frame now (tesla): B1 during a pulse, and the offset's ΔB. */
  fieldNow() {
    if (this.pulse) return this.pulse.Beff;
    return [0, 0, -(2 * Math.PI * this.p.offsetHz) / GAMMA];
  }

  // -------------------------------------------------------------------- the board's cycle

  /**
   * Start the board's cycle at t = 0: polarize for tp with Bp along the coil's axis x̂ (across
   * the Earth's field BE along ẑ), switch off in a linear ramp of `ramp`, listen for tl; the
   * receiver opens tOpen after the switch-off (the relay).  M is in units of the full
   * polarization in Bp; M (lab frame) carries on from where the last cycle left it.
   */
  startEarth({ Bp, BE, tp, ramp, tl, tOpen = 0.019 }, M = null) {
    const B = Math.hypot(Bp, BE);
    const M0E = BE / B;                      // the equilibrium in the Earth's field alone
    const Mlab = M ? [...M] : [0, 0, M0E];   // (each cycle starts from the Earth's field's equilibrium)
    this.mode = 'earth';
    this.earth = { Bp, BE, tp, ramp, tl, tOpen, M0E, M: Mlab, Bpol: [Bp, 0, BE], npol: [Bp / B, 0, BE / B], phase: 'polarize' };
    this.t = 0; this.tEnd = tp + ramp + tl; this.done = false;
    this.record.clear();
    this.pulse = null; this.queue = []; this.sent = [];
    this.ens.set(toRotating(Mlab, this.omegaRef, 0));
    this.sample();
    this._grid();
    return this;
  }

  /** Which part of the cycle the clock is in, and its end. */
  _earthPhase(t = this.t) {
    const e = this.earth;
    if (t < e.tp) return ['polarize', e.tp];
    if (t < e.tp + e.ramp) return ['ramp', e.tp + e.ramp];
    return ['listen', e.tp + e.ramp + e.tl];
  }

  // ------------------------------------------------------------------------- the clock

  /**
   * Move the clock on by dt seconds, stepping the spins, sending the pulses that fall due, and
   * sampling the record on its grid.  `budget` bounds the work (spin-steps) in one call: when
   * it is used up the clock stops short, and the amount done is returned.
   */
  advance(dt, budget = Infinity) {
    const tStart = this.t;
    // (A step that reaches the end to within rounding ends there.)
    const tEnd = this.t + dt >= this.tEnd * (1 - 1e-12) ? this.tEnd : this.t + dt;
    let work = 0;
    for (let guard = 0; guard < 1e7; guard++) {
      // First what is due now: the end of a pulse, the next pulse, a new part of the board's
      // cycle, a sample.
      if (this.pulse && this.t >= this.pulse.t1) this.pulse = null;
      while (!this.pulse && this.queue.length && this.queue[0].t <= this.t) this._start(this.queue.shift());
      if (this.earth) {
        const [ph] = this._earthPhase();
        if (ph !== this.earth.phase) {
          if (ph === 'listen') this.ens.set(toRotating(this.earth.M, this.omegaRef, this.t));
          this.earth.phase = ph;
        }
      }
      if (this.t >= this.nextSample) { this.sample(); this._grid(); }
      if (this.t >= tEnd || work >= budget) break;
      // Then on to the next of those that lies ahead.
      let next = tEnd;
      const ahead = (x) => { if (x > this.t && x < next) next = x; };
      if (this.pulse) { ahead(this.pulse.t1); ahead(this.t + this.pulse.dur / 16); }
      else if (this.queue.length) ahead(this.queue[0].t);
      if (this.earth) { const e = this.earth; ahead(e.tp); ahead(e.tp + e.ramp); ahead(e.tp + e.ramp + e.tOpen); }
      ahead(this.nextSample);
      work += this._stepTo(next);
      this.t = next;
    }
    if (this.t >= this.tEnd) this.done = true;
    const R = this.record;
    if (this.t > tStart && (R.length === 0 || R.t[R.length - 1] < this.t)) this.sample();
    return this.t - tStart;
  }

  /** The physics between this.t and `next`.  Returns the spin-steps done. */
  _stepTo(next) {
    const dt = next - this.t, { T1, T2 } = this.p;
    if (!this.earth) { this.ens.step(dt, this.fieldNow(), T1, T2, 1); return this.ens.N; }
    const e = this.earth, [ph] = this._earthPhase();
    if (ph === 'polarize') { blochStep(e.M, e.Bpol, dt, T1, T2, 1, e.npol); return 1; }
    if (ph === 'ramp') {
      let n = 0;
      integrate(e.M, (t) => rampField(e.Bp, e.BE, e.ramp, t - e.tp), this.t, next,
        { T1, T2, M0: e.M0E, axis: 'field', Bref: e.BE, perPeriod: 16, dtMax: e.ramp / 200, onStep: () => n++ });
      return n;
    }
    this.ens.step(dt, this.fieldNow(), T1, T2, e.M0E);
    return this.ens.N;
  }

  /** Record the magnetization now (zero while the board's receiver is off). */
  sample() {
    const R = this.record;
    if (this.earth && this.t < this.earth.tp + this.earth.ramp + this.earth.tOpen) { R.push(this.t, 0, 0, 0, this.rng, this.p.averages); return; }
    const m = this.ens.sum(this._v);
    R.push(this.t, m[0], m[1], m[2], this.rng, this.p.averages);
  }

  // ------------------------------------------------------------------------ what is seen

  /** The mean magnetization now, in the rotating frame or the lab frame. */
  sum(frame = 'rot', out = [0, 0, 0]) {
    if (this.earth && this.earth.phase !== 'listen') {
      const M = this.earth.M;
      if (frame === 'lab') { out[0] = M[0]; out[1] = M[1]; out[2] = M[2]; return out; }
      return toRotating(M, this.omegaRef, this.t, out);
    }
    this.ens.sum(out);
    return frame === 'lab' ? toLab(out, this.omegaRef, this.t, out) : out;
  }

  /**
   * `count` of the spins now (evenly spaced through the spread, so they are themselves its
   * quantiles), in the frame asked for; all of them when count is not given.  While the board
   * polarizes, every spin is the one vector.
   */
  vectors(frame = 'rot', count = this.ens.N) {
    const N = this.ens.N, n = Math.max(1, Math.min(N, count)), out = [];
    if (this.earth && this.earth.phase !== 'listen') { const m = this.sum(frame); for (let i = 0; i < n; i++) out.push([...m]); return out; }
    const c = Math.cos(-this.omegaRef * this.t), s = Math.sin(-this.omegaRef * this.t);
    for (let k = 0; k < n; k++) {
      const v = this.ens.get(Math.floor(((k + 0.5) * N) / n));
      if (frame === 'lab') { const x = v[0] * c - v[1] * s, y = v[0] * s + v[1] * c; v[0] = x; v[1] = y; }
      out.push(v);
    }
    return out;
  }

  /** The offset (Hz) of each of `count` spins chosen as vectors() chooses them. */
  offsetsHz(count = this.ens.N) {
    const N = this.ens.N, n = Math.max(1, Math.min(N, count)), out = new Float64Array(n);
    for (let k = 0; k < n; k++) out[k] = this.ens.offsets[Math.floor(((k + 0.5) * N) / n)] / (2 * Math.PI);
    return out;
  }

  /** Drop the record before tMin. */
  trim(tMin) { this.record.trim(tMin); }
}
