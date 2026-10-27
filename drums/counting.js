// Counting modes: Weyl's law and the statistics of level spacings.  No DOM.
//
// Weyl (1911), with the corrections of Pleijel and Kac:  the number of eigenvalues below λ of a
// drum of area A and perimeter P is, on average,
//
//   N(λ) ≈ Aλ/4π − P√λ/4π + K,
//
// K from the corners and the curvature (see shapes.js).  Fitting a straight combination of λ, √λ
// and 1 to the counted staircase "hears" A and P.  For the statistics of the spacings, the
// smooth part of the staircase is divided out ("unfolding": x_k = N̄(λ_k)) so that the mean
// spacing is 1 everywhere; then a regular (integrable) drum has the spacings of random numbers,
// P(s) = e^{−s}, and a chaotic one shows level repulsion, close to Wigner's surmise for the
// Gaussian orthogonal ensemble, P(s) = (πs/2) e^{−πs²/4}.

export const weyl = (A, P, K, lambda) => (A * lambda) / (4 * Math.PI) - (P * Math.sqrt(lambda)) / (4 * Math.PI) + (K ?? 0);
export const poisson = (s) => Math.exp(-s);
export const wigner = (s) => ((Math.PI * s) / 2) * Math.exp((-Math.PI * s * s) / 4);
/** The fraction of spacings below s: Poisson and Wigner. */
export const poissonBelow = (s) => 1 - Math.exp(-s);
export const wignerBelow = (s) => 1 - Math.exp((-Math.PI * s * s) / 4);

/** Least squares: coefficients c of Σ c_j f_j(x) through (x_i, y_i). */
function leastSquares(xs, ys, basis) {
  const m = basis.length, M = new Float64Array(m * m), v = new Float64Array(m);
  for (let i = 0; i < xs.length; i++) {
    const f = basis.map((b) => b(xs[i]));
    for (let r = 0; r < m; r++) { v[r] += f[r] * ys[i]; for (let c = 0; c < m; c++) M[r * m + c] += f[r] * f[c]; }
  }
  // Gaussian elimination with partial pivoting.
  const A = Array.from({ length: m }, (_, r) => [...M.slice(r * m, r * m + m), v[r]]);
  for (let c = 0; c < m; c++) {
    let p = c;
    for (let r = c + 1; r < m; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]];
    for (let r = c + 1; r < m; r++) { const f = A[r][c] / A[c][c]; for (let k = c; k <= m; k++) A[r][k] -= f * A[c][k]; }
  }
  const x = new Float64Array(m);
  for (let r = m - 1; r >= 0; r--) { let s = A[r][m]; for (let k = r + 1; k < m; k++) s -= A[r][k] * x[k]; x[r] = s / A[r][r]; }
  return x;
}

/**
 * The grid's own correction to the counting.  The 5-point Laplacian gives a plane wave of
 * wavenumber k at angle θ the eigenvalue k² − (h²/12)k⁴(cos⁴θ + sin⁴θ) + ..., so on average over
 * directions it lowers λ to λ(1 − λh²/16): N_grid(λ) ≈ N(λ(1 + λh²/16)).  This undoes it.
 */
export const gridCorrected = (lambda, h) => lambda * (1 + (lambda * h * h) / 16);

/**
 * Hear the area and the perimeter: fit N(λ) = aλ + b√λ + c to the staircase (each eigenvalue
 * λ_k counted as k − 1/2, the middle of its step).  opts: h (undo the grid's correction first),
 * K (Weyl's constant, if known: then only a and b are fitted).
 */
export function hearShape(values, { h = 0, K = null } = {}) {
  const xs = [], ys = [];
  for (let k = 0; k < values.length; k++) { xs.push(h ? gridCorrected(values[k], h) : values[k]); ys.push(k + 0.5 - (K ?? 0)); }
  if (xs.length < 4) return null;
  let a, b, c;
  if (K === null) [a, b, c] = leastSquares(xs, ys, [(l) => l, (l) => Math.sqrt(l), () => 1]);
  else { [a, b] = leastSquares(xs, ys, [(l) => l, (l) => Math.sqrt(l)]); c = K; }
  return { a, b, c, area: 4 * Math.PI * a, perimeter: -4 * Math.PI * b, K: c };
}

/**
 * Nearest-neighbour spacings of the unfolded spectrum.  The smooth staircase N̄ is a fit of
 * 1, √λ, λ and λ^{3/2} (the last term absorbs the grid's slow drift away from Weyl at high λ).
 */
export function spacings(values, skip = 5) {
  const xs = [], ys = [];
  for (let k = 0; k < values.length; k++) { xs.push(values[k]); ys.push(k + 0.5); }
  if (values.length - skip < 6) return null;
  const c = leastSquares(xs.slice(skip), ys.slice(skip), [() => 1, (l) => Math.sqrt(l), (l) => l, (l) => l * Math.sqrt(l)]);
  const smooth = (l) => c[0] + c[1] * Math.sqrt(l) + c[2] * l + c[3] * l * Math.sqrt(l);
  const x = values.slice(skip).map(smooth), s = [];
  for (let k = 1; k < x.length; k++) s.push(x[k] - x[k - 1]);
  const mean = s.reduce((p, q) => p + q, 0) / s.length;
  const below = (t) => s.filter((v) => v < t).length / s.length;
  return { s, mean, small: below(0.25), smooth };
}

/** A normalised histogram (a density) of values in [0, top) with `bins` bins. */
export function histogram(values, top, bins) {
  const h = new Float64Array(bins), w = top / bins;
  for (const v of values) { const b = Math.floor(v / w); if (b >= 0 && b < bins) h[b]++; }
  for (let b = 0; b < bins; b++) h[b] /= values.length * w;
  return h;
}
