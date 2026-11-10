// Spins under the Bloch equations: a row, a column or a grid of isochromats (small groups of
// protons at one place, with one proton density, T1 and T2) in a field B0 along z plus
// gradients, tipped by RF pulses, precessing, relaxing.  No DOM: the tests import this.
//
// Units: lengths in mm, times in ms, gradients in mT/m, frequencies in kHz.  For protons
// gamma / 2 pi = 42.577 MHz/T, so a gradient G (mT/m) makes the Larmor frequency vary with
// position by GB * G * x kHz per mm, and an integral of G over t (mT/m . ms) winds the phase
// across the sample by k = GB * G * t cycles per mm.
//
// Everything is seen from the frame that turns with the Larmor precession at the centre of the
// magnet, f0 = 42.577 MHz/T * B0: the receiver's frame, in which a spin at the centre stands
// still and one at x turns at GB G x.  Protons precess clockwise seen from +z (gamma > 0): the
// transverse magnetization Mx + i My goes as exp(-2 pi i f t), so the phase wound by a gradient
// is -2 pi k . r, and the signal is s = integral of m(r) exp(-2 pi i k . r), the Fourier
// transform with the minus sign in the exponent (the convention of lib/fft.js).

export const GB = 0.042577;                       // kHz per (mT/m . mm), and cycles/mm per (mT/m . ms)
export const larmorMHz = (B0) => 42.577 * B0;     // MHz
export const TWO_PI = 2 * Math.PI;

/** Rotate the vector (x, y, z) by angle a about the unit axis (ux, uy, uz), right-handed (Rodrigues). */
export function rotate(v, ux, uy, uz, a) {
  const c = Math.cos(a), s = Math.sin(a), t = 1 - c;
  const [x, y, z] = v, d = ux * x + uy * y + uz * z;
  return [
    x * c + (uy * z - uz * y) * s + ux * d * t,
    y * c + (uz * x - ux * z) * s + uy * d * t,
    z * c + (ux * y - uy * x) * s + uz * d * t,
  ];
}

/**
 * A set of isochromats.  Positions x, y, z (mm), equilibrium magnetization m0 (the proton
 * density), T1, T2 (ms), and df: an extra offset of the Larmor frequency (kHz) from the field's
 * unevenness or a chemical shift.  The state is mx, my, mz.  A T1 or T2 of NO_RELAX (1e9 ms, the
 * default) means none: the steps skip its exponential, which would be 1 to 1e-11.
 */
export const NO_RELAX = 1e9;
export class Spins {
  constructor(n) {
    this.n = n;
    for (const k of ['x', 'y', 'z', 'm0', 'T1', 'T2', 'df', 'mx', 'my', 'mz']) this[k] = new Float64Array(n);
    this.m0.fill(1); this.T1.fill(NO_RELAX); this.T2.fill(NO_RELAX);
    this.reset();
  }

  /** A row along x: xs (mm) with proton densities rho (or 1). */
  static row(xs, rho = null, T1 = NO_RELAX, T2 = NO_RELAX) {
    const s = new Spins(xs.length);
    for (let i = 0; i < xs.length; i++) { s.x[i] = xs[i]; s.m0[i] = rho ? rho[i] : 1; s.T1[i] = T1; s.T2[i] = T2; }
    s.reset();
    return s;
  }

  /** A column along z. */
  static column(zs, T1 = NO_RELAX, T2 = NO_RELAX) {
    const s = new Spins(zs.length);
    for (let i = 0; i < zs.length; i++) { s.z[i] = zs[i]; s.T1[i] = T1; s.T2[i] = T2; }
    s.reset();
    return s;
  }

  /** All spins at equilibrium, along z. */
  reset() { this.mx.fill(0); this.my.fill(0); for (let i = 0; i < this.n; i++) this.mz[i] = this.m0[i]; }

  /**
   * A hard RF pulse: a rotation by `angle` about an axis in the transverse plane at `axisPhase`
   * from x'.  Protons turn clockwise about the field, so a pulse along -y' tips z to +x'
   * (angle pi/2, axisPhase -pi/2), and a pi pulse along x' turns My to -My: it conjugates
   * Mx + i My, the refocusing of a spin echo.
   */
  pulse(angle, axisPhase = -Math.PI / 2) {
    const ux = Math.cos(axisPhase), uy = Math.sin(axisPhase);
    const c = Math.cos(-angle), s = Math.sin(-angle), t = 1 - c;
    const { mx, my, mz } = this;
    for (let i = 0; i < this.n; i++) {
      const x = mx[i], y = my[i], z = mz[i], d = ux * x + uy * y;
      mx[i] = x * c + (uy * z) * s + ux * d * t;
      my[i] = y * c + (-ux * z) * s + uy * d * t;
      mz[i] = z * c + (ux * y - uy * x) * s;
    }
  }

  /**
   * Free precession for dt ms under gradients Gx, Gy, Gz (mT/m) and each spin's offset df:
   * Mx + i My turns by exp(-2 pi i f dt) with f = GB (Gx x + Gy y + Gz z) + df (kHz), and
   * relaxes.  Exact for constant gradients, however long dt is.
   */
  precess(dt, Gx = 0, Gy = 0, Gz = 0) {
    const { x, y, z, df, mx, my, mz, m0, T1, T2 } = this;
    for (let i = 0; i < this.n; i++) {
      const phi = TWO_PI * (GB * (Gx * x[i] + Gy * y[i] + Gz * z[i]) + df[i]) * dt;
      const c = Math.cos(phi), s = Math.sin(phi), a = mx[i], b = my[i], e2 = T2[i] >= NO_RELAX ? 1 : Math.exp(-dt / T2[i]);
      mx[i] = (a * c + b * s) * e2;
      my[i] = (b * c - a * s) * e2;
      if (T1[i] < NO_RELAX) mz[i] = m0[i] + (mz[i] - m0[i]) * Math.exp(-dt / T1[i]);
    }
  }

  /**
   * One step of a shaped RF pulse: b1x, b1y is the RF field in the rotating frame as a
   * frequency (gamma B1 / 2 pi, kHz); with the gradient and the offsets it makes the effective
   * field (b1x, b1y, fz); the spins turn clockwise about it by 2 pi |f| dt, then relax.
   */
  rfStep(b1x, b1y, dt, Gx = 0, Gy = 0, Gz = 0, dfRF = 0) {
    const { x, y, z, df, mx, my, mz, m0, T1, T2 } = this, b2 = b1x * b1x + b1y * b1y;
    for (let i = 0; i < this.n; i++) {
      const fz = GB * (Gx * x[i] + Gy * y[i] + Gz * z[i]) + df[i] - dfRF;
      const f = Math.sqrt(b2 + fz * fz);
      if (f > 0) {
        const ux = b1x / f, uy = b1y / f, uz = fz / f, a = -TWO_PI * f * dt;
        const c = Math.cos(a), s = Math.sin(a), t = 1 - c;
        const X = mx[i], Y = my[i], Z = mz[i], d = ux * X + uy * Y + uz * Z;
        mx[i] = X * c + (uy * Z - uz * Y) * s + ux * d * t;
        my[i] = Y * c + (uz * X - ux * Z) * s + uy * d * t;
        mz[i] = Z * c + (ux * Y - uy * X) * s + uz * d * t;
      }
      if (T2[i] < NO_RELAX) { const e2 = Math.exp(-dt / T2[i]); mx[i] *= e2; my[i] *= e2; }
      if (T1[i] < NO_RELAX) mz[i] = m0[i] + (mz[i] - m0[i]) * Math.exp(-dt / T1[i]);
    }
  }

  /** The signal: the sum of the transverse magnetization, [re, im]. */
  signal() {
    let re = 0, im = 0;
    for (let i = 0; i < this.n; i++) { re += this.mx[i]; im += this.my[i]; }
    return [re, im];
  }

  /** The phase (radians) and transverse magnitude of spin i. */
  phase(i) { return Math.atan2(this.my[i], this.mx[i]); }
  mxy(i) { return Math.hypot(this.mx[i], this.my[i]); }
}

// ------------------------------------------------------------------- shaped pulses

/**
 * A sinc pulse of bandwidth bw (kHz), length T (ms) and flip angle `flip` (radians, at its
 * centre frequency, by the small-tip rule 2 pi integral of b1 dt = flip), windowed (Hamming),
 * sampled at n points: { t, b1 } with t in ms from the start and b1 in kHz.  Its spectrum is
 * (nearly) a rectangle of width bw: with a gradient Gz it tips a slab bw / (GB Gz) thick.
 */
export function sincPulse(bw, T, flip = Math.PI / 2, n = 240) {
  const t = new Float64Array(n), b1 = new Float64Array(n), dt = T / n;
  let area = 0;
  for (let i = 0; i < n; i++) {
    const ti = (i + 0.5) * dt, u = Math.PI * bw * (ti - T / 2);
    const w = 0.54 + 0.46 * Math.cos((TWO_PI * (ti - T / 2)) / T);
    t[i] = ti;
    b1[i] = w * (Math.abs(u) < 1e-9 ? 1 : Math.sin(u) / u);
    area += b1[i] * dt;
  }
  const A = flip / (TWO_PI * area);
  for (let i = 0; i < n; i++) b1[i] *= A;
  return { t, b1, dt, T, bw, flip };
}

/**
 * The slice a pulse selects: a column of spins along z, at rest, taken through the pulse under
 * the gradient Gz (mT/m) with the RF at the offset fc (kHz) from f0, then (if rephase) through a
 * lobe of -Gz lasting half the pulse, which undoes the phase the gradient wound across the slab
 * during the second half of the pulse.  Returns {z, mxy, phase, mz} (mxy: |Mx + i My| per unit
 * m0), the ideal thickness bw / (GB Gz) and centre fc / (GB Gz), and the measured full width at
 * half maximum of mxy(z).
 */
export function sliceProfile({ Gz, bw, T = 3, flip = Math.PI / 2, fc = 0, rephase = true, zs = null, n = 240 }) {
  const z = zs || Float64Array.from({ length: 241 }, (_, i) => -120 + i);
  const spins = Spins.column(z);
  const p = sincPulse(bw, T, flip, n);
  // (B1 along -y, as for the hard pi/2 pulse: a spin at the centre of the slab ends along +x'.)
  for (let i = 0; i < n; i++) spins.rfStep(0, -p.b1[i], p.dt, 0, 0, Gz, fc);
  if (rephase) spins.precess(T / 2, 0, 0, -Gz);
  const mxy = Float64Array.from(spins.mx, (v, i) => Math.hypot(v, spins.my[i]));
  const phase = Float64Array.from(spins.mx, (v, i) => Math.atan2(spins.my[i], v));
  const thickness = Math.abs(bw / (GB * Gz)), centre = fc / (GB * Gz);
  return { z, mxy, phase, mz: Float64Array.from(spins.mz), thickness, centre, fwhm: fwhm(z, mxy), pulse: p };
}

/** The full width at half maximum of a curve y(x) (x increasing), interpolated between samples. */
export function fwhm(x, y) {
  let imax = 0;
  for (let i = 1; i < y.length; i++) if (y[i] > y[imax]) imax = i;
  const half = y[imax] / 2;
  if (!(half > 0)) return 0;
  let a = x[0], b = x[x.length - 1];
  for (let i = imax; i > 0; i--) if (y[i - 1] < half) { a = x[i - 1] + ((half - y[i - 1]) / (y[i] - y[i - 1])) * (x[i] - x[i - 1]); break; }
  for (let i = imax; i < y.length - 1; i++) if (y[i + 1] < half) { b = x[i] + ((y[i] - half) / (y[i] - y[i + 1])) * (x[i + 1] - x[i]); break; }
  return b - a;
}

// ------------------------------------------------------------------ one dimension

/**
 * The free induction decay of a sample made of blocks along x, each {x, w, rho} (centre, width
 * in mm, density), after a pi/2 pulse, under a gradient G (mT/m), decaying with T2 (ms; T2* of
 * the magnet), sampled at the times t (ms): s(t) = sum of rho w sinc(pi GB G w t)
 * exp(-2 pi i GB G x t) exp(-t / T2), exactly, with the phase that the gradient winds.
 */
export function blocksFID(blocks, G, T2, t) {
  const n = t.length, re = new Float64Array(n), im = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const ti = t[i], decay = Math.exp(-ti / T2);
    let a = 0, b = 0;
    for (const bl of blocks) {
      const u = Math.PI * GB * G * bl.w * ti, env = bl.rho * bl.w * (Math.abs(u) < 1e-12 ? 1 : Math.sin(u) / u);
      const phi = -TWO_PI * GB * G * bl.x * ti;
      a += env * Math.cos(phi); b += env * Math.sin(phi);
    }
    re[i] = a * decay; im[i] = b * decay;
  }
  return { re, im };
}

/** The profile of the blocks along x, rho(x), at the positions xs. */
export function blocksProfile(blocks, xs) {
  return Float64Array.from(xs, (x) => blocks.reduce((s, b) => s + (Math.abs(x - b.x) <= b.w / 2 ? b.rho : 0), 0));
}

/**
 * The spectrum of a sampled FID by the FFT: the samples s(t) from t = 0 at spacing dt (ms),
 * zero-padded to at least `pad` points, give S(f) = integral of s(t) e^{+2 pi i f t} dt at
 * frequencies f = m / (M dt) kHz for m = -M/2 .. M/2 - 1 (centred).  The plus sign: a spin
 * precessing at f turns as e^{-2 pi i f t}, and the spectrum puts it at +f, so that a higher
 * frequency means a larger x under a positive gradient.  Returns {f (kHz), re, im, mag, df}
 * in units of s per kHz: the real part is the absorption spectrum (the signal starts along
 * x', so no phasing is needed), of area s(0)/2 for a decaying FID; the first sample is given
 * half weight, as the trapezoid rule for a one-sided record wants.
 */
export function spectrumOf(re, im, dt, pad = 2048, fftCentered) {
  let M = 4;
  while (M < Math.max(pad, 2 * re.length)) M *= 2;
  const R = new Float64Array(M), I = new Float64Array(M);
  // The samples go from the centre of the array on (fftCentered puts t = 0 at index M/2).
  R.set(re, M / 2); I.set(im, M / 2);
  R[M / 2] *= 0.5; I[M / 2] *= 0.5;
  fftCentered(R, I, true);
  // Unitary transform: the samples' sum is R[M/2] sqrt(M); the integral is sum * dt.
  const scale = dt * Math.sqrt(M), f = new Float64Array(M), mag = new Float64Array(M);
  for (let m = 0; m < M; m++) { f[m] = (m - M / 2) / (M * dt); R[m] *= scale; I[m] *= scale; mag[m] = Math.hypot(R[m], I[m]); }
  return { f, re: R, im: I, mag, M, df: 1 / (M * dt) };
}

/**
 * The spectrum of the part of a record measured so far: S(f) = integral from 0 to tNow of
 * s(t) e^{+2 pi i f t} dt (the sign of spectrumOf), by the trapezoid rule on the samples
 * (t, re, im) at spacing dt, the last interval cut at tNow.  At the frequencies fs (kHz);
 * returns {re, im}.  For the whole record of an FID under a gradient, 2 GB G Re S(GB G x) is
 * the profile rho(x), blurred over 1 / (2 GB G tNow): the longer the record, the finer it is.
 */
export function partialSpectrum(t, re0, im0, tNow, fs, taper = 0) {
  const n = t.length, dt = n > 1 ? t[1] - t[0] : 1, outRe = new Float64Array(fs.length), outIm = new Float64Array(fs.length);
  if (!(tNow > 0)) return { re: outRe, im: outIm };
  // A taper (a Tukey window over the last fraction `taper` of what is recorded so far) brings the
  // record smoothly to zero at tNow, so that the spectrum does not ring from the cut; it leaves
  // the area of the absorption, s(0)/2, as it is.
  let re = re0, im = im0;
  if (taper > 0) {
    const t0 = (1 - taper) * tNow, w = (tt) => (tt <= t0 ? 1 : tt >= tNow ? 0 : 0.5 * (1 + Math.cos((Math.PI * (tt - t0)) / (taper * tNow))));
    re = Float64Array.from(re0, (v, i) => v * w(t[i])); im = Float64Array.from(im0, (v, i) => v * w(t[i]));
  }
  // Whole intervals up to sample m, then the piece from t[m] to tNow (none once the record is over).
  const m = Math.min(n - 1, Math.floor(tNow / dt + 1e-9)), h = m < n - 1 ? Math.min(dt, tNow - t[m]) : 0;
  const frac = h / dt, j = Math.min(n - 1, m + 1), keep = taper > 0 ? 0 : 1;
  const endRe = keep * (re[m] + (re[j] - re[m]) * frac), endIm = keep * (im[m] + (im[j] - im[m]) * frac);
  for (let q = 0; q < fs.length; q++) {
    const w = TWO_PI * fs[q];
    let sr = 0, si = 0;
    for (let i = 0; i <= m && m > 0; i++) {
      const a = w * t[i], c = Math.cos(a), s = Math.sin(a), wt = i === 0 || i === m ? 0.5 * dt : dt;
      sr += wt * (re[i] * c - im[i] * s); si += wt * (re[i] * s + im[i] * c);
    }
    if (h > 0) {
      const a0 = w * t[m], a1 = w * (t[m] + h);
      sr += 0.5 * h * (re[m] * Math.cos(a0) - im[m] * Math.sin(a0) + endRe * Math.cos(a1) - endIm * Math.sin(a1));
      si += 0.5 * h * (re[m] * Math.sin(a0) + im[m] * Math.cos(a0) + endRe * Math.sin(a1) + endIm * Math.cos(a1));
    }
    outRe[q] = sr; outIm[q] = si;
  }
  return { re: outRe, im: outIm };
}

/**
 * Offsets of the Larmor frequency (kHz) for n spins, as an uneven magnet gives them: drawn
 * from a Lorentzian of half-width 1 / (2 pi T2prime) (T2prime in ms), so that together they
 * dephase as exp(-t / T2prime), and seeded, so that each spin keeps its own.
 */
export function lorentzOffsets(n, T2prime, seed = 3) {
  let s = (seed >>> 0) || 1;
  const rand = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  const out = new Float64Array(n), hw = 1 / (TWO_PI * T2prime);
  for (let i = 0; i < n; i++) out[i] = Number.isFinite(T2prime) ? hw * Math.tan(Math.PI * (rand() - 0.5) * 0.98) : 0;
  return out;
}

/**
 * A column of spins along z taken through slice selection, with snapshots for an animation:
 * the sinc pulse (bandwidth bw kHz, length T ms, flip angle, at the offset fc kHz from f0)
 * under the gradient Gz from t = 0 to T, then from T to 1.5 T the rephasing lobe -Gz (or no
 * gradient, if not rephase).  It is seen from a frame that turns with the centre of the slab,
 * z0 = fc / (GB Gz): the pulse's own frame while it plays, and after it the frame in which the
 * spins at z0 stand still, so that the slab's centre ends along x' wherever the slice is (a
 * scanner sets the pulse's phase to the same effect).  zs: the spins' heights (mm).
 * Returns {zs, times, mx, my, mz}
 * with one Float32Array of the column per snapshot, `frames` of them evenly spaced from 0 to
 * 1.5 T, and the pulse.
 */
export function sliceMovie({ Gz, bw, T = 3, flip = Math.PI / 2, fc = 0, rephase = true, zs, frames = 90, n = 240 }) {
  const spins = Spins.column(zs), p = sincPulse(bw, T, flip, n), Tend = 1.5 * T;
  const times = Float64Array.from({ length: frames }, (_, i) => (i * Tend) / (frames - 1));
  const mx = [], my = [], mz = [];
  const snap = () => { mx.push(Float32Array.from(spins.mx)); my.push(Float32Array.from(spins.my)); mz.push(Float32Array.from(spins.mz)); };
  let t = 0, k = 0;
  snap();
  for (let f = 1; f < frames; f++) {
    const target = times[f];
    while (t < target - 1e-12) {
      if (t < T - 1e-12 && k < n) {
        // One step of the pulse (B1 along -y), or the part of it up to the snapshot.
        const step = Math.min(p.dt * (k + 1) - t, target - t), b1 = p.b1[k];
        spins.rfStep(0, -b1, step, 0, 0, Gz, fc);
        t += step;
        if (t >= p.dt * (k + 1) - 1e-12) k++;
      } else {
        // (Seen from a frame that turns with the slab's centre, as during the pulse: there the
        // field is G(t) (z - z0), so an off-centre slice behaves as a centred one would.)
        const step = target - t;
        spins.df.fill(rephase ? fc : 0);
        spins.precess(step, 0, 0, rephase ? -Gz : 0);
        t = target;
      }
    }
    snap();
  }
  return { zs, times, mx, my, mz, pulse: p, T, Tend, thickness: Math.abs(bw / (GB * Gz)), centre: fc / (GB * Gz) };
}

/** The spectrum of a pulse's envelope b1(t) (from sincPulse), |integral of b1 e^{2 pi i f t} dt|,
 *  at the frequency offsets fs (kHz) from the pulse's own frequency; 2 pi times it is the tip
 *  angle a spin that far off resonance gets, for small tips. */
export function pulseSpectrum(p, fs) {
  const out = new Float64Array(fs.length), tc = p.T / 2, n = p.b1.length;
  for (let q = 0; q < fs.length; q++) {
    // (The samples are evenly spaced, so e^{iw(t - tc)} is turned on by e^{iw dt} from one to the
    // next rather than computed afresh: two sines a frequency, not two a sample.)
    const w = TWO_PI * fs[q], a0 = w * (p.t[0] - tc), sc = Math.cos(w * p.dt), ss = Math.sin(w * p.dt);
    let c = Math.cos(a0), s = Math.sin(a0), re = 0, im = 0;
    for (let i = 0; i < n; i++) {
      re += p.b1[i] * c; im += p.b1[i] * s;
      const c2 = c * sc - s * ss; s = s * sc + c * ss; c = c2;
    }
    out[q] = Math.hypot(re, im) * p.dt;
  }
  return out;
}
