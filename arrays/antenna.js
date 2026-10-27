// Antenna arrays: the far-field pattern is the Fourier transform of the layout.
//
// Lengths are in wavelengths, so k = 2 pi.  Time goes as exp(-i omega t): an element with complex
// weight a = A exp(i phi) radiates Re[a f(r) exp(-i omega t)], so a larger phase phi means a
// later signal (phi / omega later).  The elements lie in the plane of the screen, x to the right
// and y up, and so does every direction we look in: theta is measured from straight up (+y),
// positive towards +x, so the unit vector is r^ = (sin theta, cos theta).
//
// Two kinds of element:
//   'iso'     an isotropic point source: f = exp(ikr) / kr exactly (a scalar wave, like sound
//             from a small loudspeaker; the idealised isotropic radiator of antenna theory).
//   'dipole'  a short (Hertzian) electric dipole lying in the plane, along p^ = (cos b, sin b).
//             Its magnetic field is perpendicular to the plane, a scalar there, and exact at
//             every distance (Jackson 9.18):  B_z ~ (r^ x p^)_z (1 + i/kr) exp(ikr) / kr.
//             Far away only (r^ x p^)_z exp(ikr) / kr is left: the element pattern sin(angle
//             between r^ and p^), zero along the dipole.
//
// Far away, |r - r_n| ~ r - r^.r_n, so the field is  E(theta) AF(theta) exp(ikr) / kr  with the
// array factor  AF(theta) = sum_n a_n exp(-ik r^.r_n):  a Fourier transform of the layout,
// evaluated on the circle |k_perp| = k (pattern multiplication).

export const K = 2 * Math.PI;

/** Complex array factor at direction theta: sum a_n exp(-i k r^.r_n).  Returns [re, im]. */
export function arrayFactor(els, theta) {
  const sx = Math.sin(theta), sy = Math.cos(theta);
  let re = 0, im = 0;
  for (const e of els) {
    const ph = e.phase - K * (sx * e.x + sy * e.y);
    re += e.amp * Math.cos(ph); im += e.amp * Math.sin(ph);
  }
  return [re, im];
}

/** The element's far-field amplitude factor in the plane at direction theta (signed). */
export function elementFactor(elem, theta) {
  if (elem.kind !== 'dipole') return 1;
  // (r^ x p^)_z with r^ = (sin t, cos t), p^ = (cos b, sin b):  sin t sin b - cos t cos b.
  return -Math.cos(theta + elem.angle);
}

/** The directions sampled for patterns: m angles from -pi, uniformly. */
export function angles(m = 3600) {
  return Float64Array.from({ length: m }, (_, i) => -Math.PI + (2 * Math.PI * i) / m);
}

/**
 * Power patterns at the angles thetas: total |E AF|^2, and the two factors |AF|^2 and |E|^2.
 * Summed directly, element by element (exact; 3600 angles x 64 elements is fast enough).
 */
export function patterns(els, elem, thetas) {
  const m = thetas.length;
  const total = new Float64Array(m), af = new Float64Array(m), ef = new Float64Array(m);
  const re = new Float64Array(m), im = new Float64Array(m);
  const sx = thetas.map(Math.sin), sy = thetas.map(Math.cos);
  for (const e of els) {
    const ax = K * e.x, ay = K * e.y;
    for (let i = 0; i < m; i++) {
      const ph = e.phase - (sx[i] * ax + sy[i] * ay);
      re[i] += e.amp * Math.cos(ph); im[i] += e.amp * Math.sin(ph);
    }
  }
  for (let i = 0; i < m; i++) {
    const a = re[i] * re[i] + im[i] * im[i], f = elementFactor(elem, thetas[i]) ** 2;
    af[i] = a; ef[i] = f; total[i] = a * f;
  }
  return { total, af, ef };
}

// ------------------------------------------------------------------ reading a pattern

/** Direction of a line through the elements, if they are all on one (else null). */
export function lineAxis(els) {
  if (els.length < 2) return null;
  let cx = 0, cy = 0;
  for (const e of els) { cx += e.x; cy += e.y; }
  cx /= els.length; cy /= els.length;
  let sxx = 0, sxy = 0, syy = 0;
  for (const e of els) { const dx = e.x - cx, dy = e.y - cy; sxx += dx * dx; sxy += dx * dy; syy += dy * dy; }
  if (sxx + syy < 1e-18) return null;
  // The principal axis of the spread, and the spread across it.
  const a = 0.5 * Math.atan2(2 * sxy, sxx - syy), ux = Math.cos(a), uy = Math.sin(a);
  let off = 0;
  for (const e of els) off = Math.max(off, Math.abs(-(e.x - cx) * uy + (e.y - cy) * ux));
  if (off > 1e-6) return null;
  return Math.atan2(ux, uy);          // as a pattern angle theta (from +y towards +x)
}

const wrapAngle = (t) => t - 2 * Math.PI * Math.round(t / (2 * Math.PI));

/**
 * Read a pattern P sampled at m = P.length angles from -pi: the beam, its half-power width, and
 * the highest sidelobe.
 *   prefer   when several directions are equally strong, the beam is the one nearest this
 *   mirror   for elements on one line, the line's direction: the pattern is then the same on
 *            both sides of the line, and the mirror image of the main lobe is not a sidelobe
 * Returns { beam, hpbw, lobe: [from, to], sll (dB, or null), sllAngle, omni }.
 */
export function analysePattern(P, { prefer = 0, mirror = null } = {}) {
  const m = P.length, dth = (2 * Math.PI) / m, th = (i) => -Math.PI + dth * (((i % m) + m) % m);
  const at = (i) => P[((i % m) + m) % m];
  let pmax = 0, pmin = Infinity;
  for (let i = 0; i < m; i++) { if (P[i] > pmax) pmax = P[i]; if (P[i] < pmin) pmin = P[i]; }
  if (!(pmax > 0)) return { beam: null, hpbw: null, sll: null, omni: true };
  let best = 0, bestD = Infinity;
  for (let i = 0; i < m; i++) {
    if (P[i] < pmax * (1 - 1e-9)) continue;
    const d = Math.abs(wrapAngle(th(i) - prefer));
    if (d < bestD - 1e-12) { bestD = d; best = i; }
  }
  // Refine the peak with a parabola through the three samples.
  const y0 = at(best - 1), y1 = at(best), y2 = at(best + 1), den = y0 - 2 * y1 + y2;
  const beam = wrapAngle(th(best) + (den < 0 ? (0.5 * (y0 - y2) / den) * dth : 0));
  if (pmin > 0.5 * pmax) return { beam, hpbw: null, sll: null, omni: true };
  // Half-power points, walking out from the peak.
  const half = 0.5 * pmax;
  const walk = (dir) => {
    for (let s = 1; s < m / 2; s++) {
      const a = at(best + dir * s);
      if (a < half) { const b = at(best + dir * (s - 1)); return (s - 1 + (b - half) / (b - a)) * dth; }
    }
    return Math.PI;
  };
  const hpbw = walk(-1) + walk(1);
  // The main lobe runs out to the first minimum on each side.
  const edge = (dir) => { let s = 1; while (s < m / 2 && at(best + dir * s) <= at(best + dir * (s - 1))) s++; return s - 1; };
  const sl = edge(-1), sr = edge(1);
  const inLobe = (i, c, l, r) => { const d = ((i - c) % m + m + m / 2) % m - m / 2; return d >= -l && d <= r; };
  let mc = null;
  if (mirror !== null) {
    // The mirror image of the main lobe across the line: theta -> 2 axis - theta.
    mc = Math.round((wrapAngle(2 * mirror - th(best)) + Math.PI) / dth) % m;
  }
  const lobes = [];
  for (let i = 0; i < m; i++) {
    // (Maxima 100 dB down are rounding noise in a null.)
    if (!(P[i] >= at(i - 1) && P[i] > at(i + 1)) || P[i] < 1e-10 * pmax) continue;
    if (inLobe(i, best, sl, sr)) continue;
    if (mc !== null && inLobe(i, mc, sr + 1, sl + 1)) continue;
    lobes.push(i);
  }
  // The highest sidelobe; of several equal ones (to 0.01 dB), the one nearest the beam.
  let sll = null, sllAngle = null;
  if (lobes.length) {
    const top = Math.max(...lobes.map((i) => P[i]));
    const near = (i) => Math.abs(wrapAngle(th(i) - th(best)));
    const pick = lobes.filter((i) => P[i] >= top / 1.0023).sort((a, b) => near(a) - near(b))[0];
    sll = top; sllAngle = th(pick);
  }
  return {
    beam, hpbw, omni: false, lobe: [th(best - sl), th(best + sr)],
    sll: sll === null ? null : 10 * Math.log10(sll / pmax), sllAngle,
  };
}

// ------------------------------------------------------------------ directivity

// Spherical Bessel functions j0(q), j1(q)/q and j2(q), with series where they cancel.
function sph(q) {
  if (q < 0.05) {
    const q2 = q * q;
    return [1 - q2 / 6 + (q2 * q2) / 120, 1 / 3 - q2 / 30 + (q2 * q2) / 840, q2 / 15 - (q2 * q2) / 210 + (q2 * q2 * q2) / 7560];
  }
  const s = Math.sin(q), c = Math.cos(q), q2 = q * q;
  return [s / q, (s / q2 - c / q) / q, ((3 / q2 - 1) * s) / q - (3 * c) / q2];
}

/**
 * The total radiated power over the whole sphere, divided by 4 pi (radiation out of the plane
 * counts too).  Exact, from
 *   (1/4pi) int exp(-ik r^.d) dOmega = j0(kd)
 *   (1/4pi) int (1 - (r^.p^)^2) exp(-ik r^.d) dOmega = j0(kd) - j1(kd)/kd + j2(kd) (p^.d^)^2
 */
export function radiatedPower(els, elem) {
  const px = Math.cos(elem.angle || 0), py = Math.sin(elem.angle || 0), dip = elem.kind === 'dipole';
  let P = 0;
  for (const a of els) {
    for (const b of els) {
      const dx = a.x - b.x, dy = a.y - b.y, d = Math.hypot(dx, dy), q = K * d;
      const [j0, j1q, j2] = sph(q);
      let G = j0;
      if (dip) { const c = d > 0 ? (dx * px + dy * py) / d : 0; G = j0 - j1q + j2 * c * c; }
      P += a.amp * b.amp * Math.cos(a.phase - b.phase) * G;
    }
  }
  return P;
}

/** Directivity D = 4 pi U(theta) / P_total towards the in-plane direction theta. */
export function directivity(els, elem, theta) {
  const [re, im] = arrayFactor(els, theta), f = elementFactor(elem, theta);
  const P = radiatedPower(els, elem);
  return P > 0 ? ((re * re + im * im) * f * f) / P : 0;
}

// ------------------------------------------------------------------ weights

/** Elements' positions projected on the layout's long axis: [order (indices sorted), t in 0..1]. */
function alongAxis(els) {
  const n = els.length;
  let cx = 0, cy = 0;
  for (const e of els) { cx += e.x; cy += e.y; }
  cx /= n; cy /= n;
  let sxx = 0, sxy = 0, syy = 0;
  for (const e of els) { const dx = e.x - cx, dy = e.y - cy; sxx += dx * dx; sxy += dx * dy; syy += dy * dy; }
  const a = 0.5 * Math.atan2(2 * sxy, sxx - syy), ux = Math.cos(a), uy = Math.sin(a);
  const s = els.map((e) => (e.x - cx) * ux + (e.y - cy) * uy);
  const order = [...s.keys()].sort((i, j) => s[i] - s[j]);
  const lo = Math.min(...s), hi = Math.max(...s);
  return { order, t: s.map((v) => (hi > lo ? (v - lo) / (hi - lo) : 0.5)) };
}

function binomial(n) {
  const w = [1];
  for (let k = 1; k < n; k++) w.push((w[k - 1] * (n - k)) / k);
  return w;
}

/** Dolph-Chebyshev weights for n elements, sidelobes sll dB below the beam (equal ripple). */
export function chebyshev(n, sll) {
  if (n < 3) return new Array(n).fill(1);
  const order = n - 1, R = 10 ** (sll / 20), x0 = Math.cosh(Math.acosh(R) / order);
  const T = (x) => (Math.abs(x) <= 1 ? Math.cos(order * Math.acos(x)) : (x > 0 ? 1 : (order % 2 ? -1 : 1)) * Math.cosh(order * Math.acosh(Math.abs(x))));
  // The pattern is T(x0 cos(psi/2)); sample it at psi = 2 pi m / n and transform back.
  const w = [];
  for (let k = 0; k < n; k++) {
    let s = 0;
    for (let m = 0; m < n; m++) {
      const psi = (2 * Math.PI * m) / n;
      s += T(x0 * Math.cos(psi / 2)) * Math.cos(psi * (k - order / 2));
    }
    w.push(s / n);
  }
  const max = Math.max(...w);
  return w.map((v) => v / max);
}

/** Taylor (n-bar) weights at normalised positions x in [-1/2, 1/2] of the aperture. */
export function taylor(xs, sll, nbar = 5) {
  const A = Math.acosh(10 ** (sll / 20)) / Math.PI, s2 = (nbar * nbar) / (A * A + (nbar - 0.5) ** 2);
  const F = [];
  for (let m = 1; m < nbar; m++) {
    let num = 1, den = 1;
    for (let k = 1; k < nbar; k++) {
      num *= 1 - (m * m) / (s2 * (A * A + (k - 0.5) ** 2));
      if (k !== m) den *= 1 - (m * m) / (k * k);
    }
    F.push(((m % 2 ? 1 : -1) * num) / (2 * den));
  }
  const w = xs.map((x) => 1 + 2 * F.reduce((s, f, i) => s + f * Math.cos(2 * Math.PI * (i + 1) * x), 0));
  const max = Math.max(...w);
  return w.map((v) => v / max);
}

/**
 * Amplitude tapers across the layout (along its long axis): 'uniform', 'binomial', 'hann',
 * 'taylor', 'chebyshev'.  Binomial and Chebyshev go by the elements' order along the axis
 * (they are made for equal spacing); Hann and Taylor by position.  Returns amplitudes, max 1.
 */
export function taper(els, kind, sll = 30) {
  const n = els.length;
  if (kind === 'uniform' || n < 2) return new Array(n).fill(1);
  const { order, t } = alongAxis(els);
  const out = new Array(n);
  if (kind === 'binomial' || kind === 'chebyshev') {
    const w = kind === 'binomial' ? binomial(n) : chebyshev(n, sll);
    const max = Math.max(...w);
    order.forEach((idx, rank) => { out[idx] = w[rank] / max; });
    return out;
  }
  // Position along an aperture one spacing longer than the array, as for a sampled aperture:
  // the end elements sit half a spacing in from its ends.
  const xs = t.map((v) => (v - 0.5) * (n - 1) / n);
  if (kind === 'taylor') return taylor(xs, sll);
  // Hann: cos^2 across the aperture, sin^2(pi (k + 1) / (n + 1)) for equal spacing.
  const xh = t.map((v) => (v - 0.5) * (n - 1) / (n + 1));
  return xh.map((x) => Math.cos(Math.PI * x) ** 2);
}

/** Phases that make the waves arrive in step in direction theta0 (relative to the centre). */
export function steerPhases(els, theta0) {
  const sx = Math.sin(theta0), sy = Math.cos(theta0);
  const [cx, cy] = centroid(els);
  return els.map((e) => wrapAngle(K * (sx * (e.x - cx) + sy * (e.y - cy))));
}

/**
 * Phases that make the waves arrive in step at the point (fx, fy): each element is delayed by
 * its distance, phi_n = -k |f - r_n| (the time-reverse of a source at f).  The element nearest
 * the focus gets phase 0.
 */
export function focusPhases(els, fx, fy) {
  const d = els.map((e) => Math.hypot(fx - e.x, fy - e.y)), dmin = Math.min(...d);
  return d.map((v) => wrapAngle(-K * (v - dmin)));
}

export function centroid(els) {
  let cx = 0, cy = 0;
  for (const e of els) { cx += e.x; cy += e.y; }
  return els.length ? [cx / els.length, cy / els.length] : [0, 0];
}

/** The largest distance between two elements (the array's size D). */
export function extent(els) {
  let d = 0;
  for (const a of els) for (const b of els) d = Math.max(d, Math.hypot(a.x - b.x, a.y - b.y));
  return d;
}

// ------------------------------------------------------------------ the field in the plane

/**
 * The complex field of all the elements on a grid of g x g pixels, pixel size h, whose top-left
 * corner is at (x0, y0) (row j is y = y0 - (j + 1/2) h).  Writes into re, im.
 * Each element's radial profile comes from a table (spacing h/8, linear interpolation), so the
 * cost per element per pixel is a square root and a lookup.  Within half a pixel of an element
 * the field is held at its value there (it diverges at the element).
 */
export function nearField(els, elem, grid, re, im) {
  const { g, h, x0, y0 } = grid;
  re.fill(0); im.fill(0);
  const dip = elem.kind === 'dipole';
  const px = Math.cos(elem.angle || 0), py = Math.sin(elem.angle || 0);
  // The farthest any pixel is from any element.
  let reach = 0;
  for (const e of els) {
    const fx = Math.max(Math.abs(x0 - e.x), Math.abs(x0 + g * h - e.x)), fy = Math.max(Math.abs(y0 - e.y), Math.abs(y0 - g * h - e.y));
    reach = Math.max(reach, Math.hypot(fx, fy));
  }
  const { tr, ti, inv, rmin } = radialTable(h, reach, dip);
  for (const e of els) {
    if (!e.amp) continue;
    const ar = e.amp * Math.cos(e.phase), ai = e.amp * Math.sin(e.phase);
    for (let j = 0; j < g; j++) {
      const dy = y0 - (j + 0.5) * h - e.y, dy2 = dy * dy, row = j * g;
      for (let i = 0; i < g; i++) {
        const dx = x0 + (i + 0.5) * h - e.x;
        let r = Math.sqrt(dx * dx + dy2);
        let s = 1;
        if (dip) s = r > 0 ? (dx * py - dy * px) / r : 0;
        if (r < rmin) r = rmin;
        const u = r * inv, k = u | 0, f = u - k;
        const fr = (tr[k] + f * (tr[k + 1] - tr[k])) * s, fi = (ti[k] + f * (ti[k + 1] - ti[k])) * s;
        re[row + i] += ar * fr - ai * fi;
        im[row + i] += ar * fi + ai * fr;
      }
    }
  }
}

let tableCache = null;
function radialTable(h, reach, dip) {
  if (tableCache && tableCache.h === h && tableCache.rmax >= reach && tableCache.dip === dip) return tableCache;
  const step = h / 8, rmax = reach * 1.25 + 4 * h, m = Math.ceil(rmax / step) + 2;
  const tr = new Float64Array(m), ti = new Float64Array(m);
  const rmin = h / 2;
  for (let k = 0; k < m; k++) {
    const r = Math.max(rmin, k * step), kr = K * r, c = Math.cos(kr) / kr, s = Math.sin(kr) / kr;
    if (dip) { const q = 1 / kr; tr[k] = c - q * s; ti[k] = s + q * c; }   // (1 + i/kr) e^{ikr}/kr
    else { tr[k] = c; ti[k] = s; }
  }
  tableCache = { h, rmax, dip, tr, ti, inv: 1 / step, rmin };
  return tableCache;
}

/** The exact field at one point (for tests and probes). */
export function fieldAt(els, elem, x, y) {
  const px = Math.cos(elem.angle || 0), py = Math.sin(elem.angle || 0);
  let re = 0, im = 0;
  for (const e of els) {
    const dx = x - e.x, dy = y - e.y, r = Math.hypot(dx, dy), kr = K * r;
    let fr = Math.cos(kr) / kr, fi = Math.sin(kr) / kr;
    if (elem.kind === 'dipole') {
      const s = (dx * py - dy * px) / r, q = 1 / kr;
      [fr, fi] = [(fr - q * fi) * s, (fi + q * fr) * s];
    }
    const ar = e.amp * Math.cos(e.phase), ai = e.amp * Math.sin(e.phase);
    re += ar * fr - ai * fi; im += ar * fi + ai * fr;
  }
  return [re, im];
}
