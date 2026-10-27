// Bessel functions of integer order and real argument, for partial waves in two dimensions:
// the plane wave is e^{ikx} = sum_m i^m J_m(kr) e^{im theta}, and an outgoing circular wave
// is H_m(kr) = J_m(kr) + i Y_m(kr).
//
//   besselJ(mmax, x)  -> Float64Array of J_0(x) ... J_mmax(x)   (Miller's backward recurrence)
//   besselY(mmax, x)  -> Float64Array of Y_0(x) ... Y_mmax(x)   (Y_0, Y_1, then recurrence up)
//
// Accurate to about 1e-10 relative for x up to a few hundred (checked against SciPy).

const EULER = 0.5772156649015329;

/** J_0 ... J_mmax at x >= 0. */
export function besselJ(mmax, x) {
  const out = new Float64Array(mmax + 1);
  if (x === 0) { out[0] = 1; return out; }
  // Start the downward recurrence J_{k-1} = (2k/x) J_k - J_{k+1} well above both mmax and x,
  // from arbitrary small values: it converges onto the true J's, and the sum rule
  // J_0 + 2 (J_2 + J_4 + ...) = 1 fixes the scale.
  const top = 2 * Math.ceil((Math.max(mmax, x) + 20 + Math.sqrt(40 * Math.max(mmax, x))) / 2);
  let jp1 = 0, j = 1e-300, sum = 0;
  for (let k = top; k > 0; k--) {
    const jm1 = ((2 * k) / x) * j - jp1;
    jp1 = j; j = jm1;
    if (k - 1 <= mmax) out[k - 1] = j;
    if ((k - 1) % 2 === 0 && k - 1 > 0) sum += 2 * j;
    if (Math.abs(j) > 1e250) {
      // Rescale to stay in range.
      j *= 1e-250; jp1 *= 1e-250; sum *= 1e-250;
      for (let i = k - 1; i <= mmax; i++) out[i] *= 1e-250;
    }
  }
  sum += j; // J_0
  for (let i = 0; i <= mmax; i++) out[i] /= sum;
  return out;
}

// Y_0 and Y_1 by their power series (A&S 9.1.13 and 9.1.11) for x <= 12, where the
// cancellation costs at most 7 of 16 digits, and by Hankel's asymptotic series beyond.
function y01(x) {
  if (x <= 12) {
    const J = besselJ(1, x), L = Math.log(x / 2) + EULER, z = (x * x) / 4;
    let term0 = 1, term1 = 1, H = 0, s0 = 0, s1 = 0;
    // term0_k = (-z)^k / (k!)^2, term1_k = (-z)^k / (k! (k+1)!)
    for (let k = 0; k < 80; k++) {
      if (k > 0) { term0 *= -z / (k * k); term1 *= -z / (k * (k + 1)); }
      const Hk = H, Hk1 = H + 1 / (k + 1);
      if (k > 0) s0 += term0 * Hk;
      s1 += term1 * (Hk + Hk1);
      H = Hk1;
      if (k > 5 && Math.abs(term0) * (Hk1 + 1) < 1e-17 * Math.abs(s0 || 1) && Math.abs(term1) * (Hk1 + 1) < 1e-17 * Math.abs(s1 || 1)) break;
    }
    const y0 = (2 / Math.PI) * L * J[0] - (2 / Math.PI) * s0;
    const y1 = -2 / (Math.PI * x) + (2 / Math.PI) * L * J[1] - (1 / Math.PI) * (x / 2) * s1;
    return [y0, y1];
  }
  const ys = [];
  for (const nu of [0, 1]) {
    const mu = 4 * nu * nu, w = 8 * x;
    // t_k = prod_{j<=k} (mu - (2j-1)^2) / (j 8x); P = t0 - t2 + t4 - ..., Q = t1 - t3 + t5 - ...
    let P = 1, Q = 0, t = 1, prev = Infinity;
    for (let k = 1; k < 60; k++) {
      t *= (mu - (2 * k - 1) ** 2) / (k * w);
      if (Math.abs(t) > prev) break; // the asymptotic series has started to diverge
      prev = Math.abs(t);
      const sign = k % 4 === 1 || k % 4 === 0 ? 1 : -1;
      if (k % 2) Q += sign * t; else P += sign * t;
      if (Math.abs(t) < 1e-17) break;
    }
    const chi = x - (nu / 2 + 0.25) * Math.PI;
    ys.push(Math.sqrt(2 / (Math.PI * x)) * (P * Math.sin(chi) + Q * Math.cos(chi)));
  }
  return ys;
}

/** Y_0 ... Y_mmax at x > 0 (the upward recurrence is stable for Y). */
export function besselY(mmax, x) {
  const out = new Float64Array(mmax + 1);
  const [y0, y1] = y01(x);
  out[0] = y0;
  if (mmax >= 1) out[1] = y1;
  for (let m = 1; m < mmax; m++) out[m + 1] = ((2 * m) / x) * out[m] - out[m - 1];
  return out;
}
