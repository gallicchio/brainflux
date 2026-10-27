// The eigenvalue problem of a drum, solved directly: -∇²φ = λφ inside a shape drawn on a square
// grid, with φ = 0 on the walls (Dirichlet), discretised by the 5-point Laplacian
//
//   (Aφ)_ij = (4φ_ij − φ_i±1,j − φ_i,j±1) / h²,
//
// a sparse, symmetric, positive definite matrix with one row per free grid point.  Its lowest
// eigenvalues are found by shift-invert block Lanczos: the Krylov space of A⁻¹, whose largest
// eigenvalues 1/λ are the drum's lowest λ, well separated, so they converge first.  Applying A⁻¹
// is a pair of triangular solves with an envelope (skyline) Cholesky factor, whose fill stays
// inside the profile of A.  Blocks of four vectors catch degenerate pairs (a square's (m, n) and
// (n, m)), which single-vector Lanczos would miss in exact arithmetic.  Every block is
// orthogonalised twice against all the earlier ones ("twice is enough"), and a Ritz pair is
// accepted only when its residual is below the tolerance.
//
// No DOM: the tests and a worker import this file.

/**
 * The free points of a mask.  mask: Uint8Array(n*n), row-major (index j*n + i, i along x), 1 for
 * a free point; the outer ring of the grid is always a wall.
 * Returns { n, h, N, pts, index, first, profile }:
 *   pts[k]   the grid index of free point k, in the order used for the matrix (rows or columns,
 *            whichever gives the smaller envelope)
 *   index[g] the free-point number of grid point g, or −1 on a wall
 *   first[k] the first column of row k's envelope
 */
export function domainOf(mask, n, h) {
  const order = (byRows) => {
    const pts = [];
    if (byRows) { for (let j = 1; j < n - 1; j++) for (let i = 1; i < n - 1; i++) if (mask[j * n + i]) pts.push(j * n + i); }
    else { for (let i = 1; i < n - 1; i++) for (let j = 1; j < n - 1; j++) if (mask[j * n + i]) pts.push(j * n + i); }
    const index = new Int32Array(n * n).fill(-1);
    pts.forEach((g, k) => { index[g] = k; });
    const first = new Int32Array(pts.length);
    let profile = 0;
    for (let k = 0; k < pts.length; k++) {
      const g = pts[k];
      let f = k;
      for (const d of [-1, 1, -n, n]) { const q = index[g + d]; if (q >= 0 && q < f) f = q; }
      first[k] = f;
      profile += k - f;
    }
    return { pts: Int32Array.from(pts), index, first, profile };
  };
  const a = order(true), b = order(false);
  const best = a.profile <= b.profile ? a : b;
  return { n, h, N: best.pts.length, pts: best.pts, index: best.index, first: best.first, profile: best.profile };
}

/** y = A x on free-point vectors (length N). */
export function applyLaplacian(dom, x, y) {
  const { n, N, pts, index } = dom, s = 1 / (dom.h * dom.h);
  for (let k = 0; k < N; k++) {
    const g = pts[k];
    let v = 4 * x[k];
    let q = index[g - 1]; if (q >= 0) v -= x[q];
    q = index[g + 1]; if (q >= 0) v -= x[q];
    q = index[g - n]; if (q >= 0) v -= x[q];
    q = index[g + n]; if (q >= 0) v -= x[q];
    y[k] = v * s;
  }
  return y;
}

/**
 * The factor of h²(A − σ) = K − σh² (K: 4 on the diagonal, −1 for each free neighbour) in
 * envelope storage: row k holds columns first[k] .. k.  With ldl = false it is a Cholesky
 * factor (K − σh² must be positive definite: σ below the lowest eigenvalue); with ldl = true it
 * is L D Lᵀ without pivoting, for any σ that is not an eigenvalue, and `negative` counts the
 * negative pivots: by Sylvester's law of inertia, the number of eigenvalues below σ.
 * The inner loops are unrolled by four: JavaScript engines don't vectorise, and four
 * independent sums run about twice as fast as one.
 */
export function factor(dom, sigma = 0, ldl = false) {
  const { n, N, pts, index, first } = dom, shift = sigma * dom.h * dom.h;
  const off = new Int32Array(N + 1);
  for (let k = 0; k < N; k++) off[k + 1] = off[k] + (k - first[k] + 1);
  const L = new Float64Array(off[N]);
  const D = ldl ? new Float64Array(N) : null;
  let negative = 0;
  for (let k = 0; k < N; k++) {
    const fk = first[k], ok = off[k] - fk; // L[ok + j] is row k, column j
    const g = pts[k];
    for (const d of [-1, 1, -n, n]) { const q = index[g + d]; if (q >= 0 && q < k) L[ok + q] = -1; }
    for (let j = fk; j < k; j++) {
      const fj = first[j], oj = off[j] - fj;
      const lo = fk > fj ? fk : fj;
      let s0 = L[ok + j], s1 = 0, s2 = 0, s3 = 0, i = lo;
      if (ldl) for (; i < j; i++) s0 -= L[ok + i] * L[oj + i] * D[i];
      else {
        for (; i + 3 < j; i += 4) {
          s0 -= L[ok + i] * L[oj + i]; s1 -= L[ok + i + 1] * L[oj + i + 1];
          s2 -= L[ok + i + 2] * L[oj + i + 2]; s3 -= L[ok + i + 3] * L[oj + i + 3];
        }
        for (; i < j; i++) s0 -= L[ok + i] * L[oj + i];
      }
      const s = s0 + s1 + s2 + s3;
      L[ok + j] = ldl ? s / D[j] : s / L[oj + j];
    }
    let s = 4 - shift;
    if (ldl) {
      for (let i = fk; i < k; i++) s -= L[ok + i] * L[ok + i] * D[i];
      D[k] = s; L[ok + k] = 1;
      if (s < 0) negative++;
    } else {
      for (let i = fk; i < k; i++) s -= L[ok + i] * L[ok + i];
      if (!(s > 0)) throw new Error('factor: not positive definite (is σ above the lowest eigenvalue?)');
      L[ok + k] = Math.sqrt(s);
    }
  }
  const h2 = dom.h * dom.h;
  /** x = (A − σ)⁻¹ b (x may be b). */
  function solve(b, x = new Float64Array(N)) {
    if (x !== b) x.set(b);
    for (let k = 0; k < N; k++) {
      const fk = first[k], ok = off[k] - fk;
      let s0 = x[k], s1 = 0, s2 = 0, s3 = 0, j = fk;
      for (; j + 3 < k; j += 4) {
        s0 -= L[ok + j] * x[j]; s1 -= L[ok + j + 1] * x[j + 1];
        s2 -= L[ok + j + 2] * x[j + 2]; s3 -= L[ok + j + 3] * x[j + 3];
      }
      for (; j < k; j++) s0 -= L[ok + j] * x[j];
      const s = s0 + s1 + s2 + s3;
      x[k] = ldl ? s : s / L[ok + k];
    }
    if (ldl) for (let k = 0; k < N; k++) x[k] /= D[k];
    for (let k = N - 1; k >= 0; k--) {
      const fk = first[k], ok = off[k] - fk;
      const v = ldl ? x[k] : (x[k] /= L[ok + k]);
      let j = fk;
      for (; j + 3 < k; j += 4) {
        x[j] -= L[ok + j] * v; x[j + 1] -= L[ok + j + 1] * v;
        x[j + 2] -= L[ok + j + 2] * v; x[j + 3] -= L[ok + j + 3] * v;
      }
      for (; j < k; j++) x[j] -= L[ok + j] * v;
    }
    for (let k = 0; k < N; k++) x[k] *= h2;
    return x;
  }
  /** The same for four right-hand sides at once, interleaved: b[4k + r] (x may be b). */
  function solve4(b, x = new Float64Array(4 * N)) {
    if (ldl) throw new Error('solve4 is for the Cholesky factor');
    if (x !== b) x.set(b);
    for (let k = 0; k < N; k++) {
      const fk = first[k], ok = off[k] - fk;
      let s0 = x[4 * k], s1 = x[4 * k + 1], s2 = x[4 * k + 2], s3 = x[4 * k + 3];
      for (let j = fk, o = 4 * fk; j < k; j++, o += 4) {
        const l = L[ok + j];
        s0 -= l * x[o]; s1 -= l * x[o + 1]; s2 -= l * x[o + 2]; s3 -= l * x[o + 3];
      }
      const d = 1 / L[ok + k];
      x[4 * k] = s0 * d; x[4 * k + 1] = s1 * d; x[4 * k + 2] = s2 * d; x[4 * k + 3] = s3 * d;
    }
    for (let k = N - 1; k >= 0; k--) {
      const fk = first[k], ok = off[k] - fk, d = 1 / L[ok + k];
      const v0 = (x[4 * k] *= d), v1 = (x[4 * k + 1] *= d), v2 = (x[4 * k + 2] *= d), v3 = (x[4 * k + 3] *= d);
      for (let j = fk, o = 4 * fk; j < k; j++, o += 4) {
        const l = L[ok + j];
        x[o] -= l * v0; x[o + 1] -= l * v1; x[o + 2] -= l * v2; x[o + 3] -= l * v3;
      }
    }
    for (let k = 0; k < 4 * N; k++) x[k] *= h2;
    return x;
  }
  return { solve, solve4, negative, size: off[N] };
}

/** The number of eigenvalues below λ (Sylvester's law of inertia), for λ not an eigenvalue. */
export function countBelow(dom, lambda) { return factor(dom, lambda, true).negative; }

// ------------------------------------------------------------------ dense symmetric eigenproblem

/**
 * Eigenvalues (ascending) and, if wanted, eigenvectors of a dense symmetric m×m matrix a
 * (Float64Array, row-major; destroyed).  Householder reduction to tridiagonal form, then the QL
 * algorithm with implicit shifts (as in Numerical Recipes' tred2 and tqli).
 * Returns { values, vectors } with vectors[i*m + k] the i-th component of eigenvector k.
 */
export function symmetricEigen(a, m, wantVectors = true) {
  const d = new Float64Array(m), e = new Float64Array(m);
  // tred2
  for (let i = m - 1; i > 0; i--) {
    const l = i - 1;
    let h = 0, scale = 0;
    if (l > 0) {
      for (let k = 0; k <= l; k++) scale += Math.abs(a[i * m + k]);
      if (scale === 0) e[i] = a[i * m + l];
      else {
        for (let k = 0; k <= l; k++) { a[i * m + k] /= scale; h += a[i * m + k] * a[i * m + k]; }
        let f = a[i * m + l];
        const g = f >= 0 ? -Math.sqrt(h) : Math.sqrt(h);
        e[i] = scale * g; h -= f * g; a[i * m + l] = f - g; f = 0;
        for (let j = 0; j <= l; j++) {
          if (wantVectors) a[j * m + i] = a[i * m + j] / h;
          let gg = 0;
          for (let k = 0; k <= j; k++) gg += a[j * m + k] * a[i * m + k];
          for (let k = j + 1; k <= l; k++) gg += a[k * m + j] * a[i * m + k];
          e[j] = gg / h; f += e[j] * a[i * m + j];
        }
        const hh = f / (h + h);
        for (let j = 0; j <= l; j++) {
          const ff = a[i * m + j], gg = e[j] - hh * ff;
          e[j] = gg;
          for (let k = 0; k <= j; k++) a[j * m + k] -= ff * e[k] + gg * a[i * m + k];
        }
      }
    } else e[i] = a[i * m + l];
    d[i] = h;
  }
  d[0] = 0; e[0] = 0;
  if (wantVectors) {
    for (let i = 0; i < m; i++) {
      const l = i - 1;
      if (d[i]) {
        for (let j = 0; j <= l; j++) {
          let g = 0;
          for (let k = 0; k <= l; k++) g += a[i * m + k] * a[k * m + j];
          for (let k = 0; k <= l; k++) a[k * m + j] -= g * a[k * m + i];
        }
      }
      d[i] = a[i * m + i]; a[i * m + i] = 1;
      for (let j = 0; j <= l; j++) { a[j * m + i] = 0; a[i * m + j] = 0; }
    }
  } else for (let i = 0; i < m; i++) d[i] = a[i * m + i];
  // tqli
  for (let i = 1; i < m; i++) e[i - 1] = e[i];
  e[m - 1] = 0;
  for (let l = 0; l < m; l++) {
    let iter = 0, mm;
    do {
      for (mm = l; mm < m - 1; mm++) {
        const dd = Math.abs(d[mm]) + Math.abs(d[mm + 1]);
        if (Math.abs(e[mm]) <= 1e-15 * dd) break;
      }
      if (mm !== l) {
        if (iter++ === 60) throw new Error('symmetricEigen: no convergence');
        let g = (d[l + 1] - d[l]) / (2 * e[l]);
        let r = Math.hypot(g, 1);
        g = d[mm] - d[l] + e[l] / (g + (g >= 0 ? Math.abs(r) : -Math.abs(r)));
        let s = 1, c = 1, p = 0, i;
        for (i = mm - 1; i >= l; i--) {
          let f = s * e[i];
          const b = c * e[i];
          e[i + 1] = r = Math.hypot(f, g);
          if (r === 0) { d[i + 1] -= p; e[mm] = 0; break; }
          s = f / r; c = g / r; g = d[i + 1] - p; r = (d[i] - g) * s + 2 * c * b;
          d[i + 1] = g + (p = s * r); g = c * r - b;
          if (wantVectors) {
            for (let k = 0; k < m; k++) {
              f = a[k * m + i + 1];
              a[k * m + i + 1] = s * a[k * m + i] + c * f;
              a[k * m + i] = c * a[k * m + i] - s * f;
            }
          }
        }
        if (r === 0 && i >= l) continue;
        d[l] -= p; e[l] = g; e[mm] = 0;
      }
    } while (mm !== l);
  }
  // Sort ascending.
  const order = Array.from({ length: m }, (_, i) => i).sort((p, q) => d[p] - d[q]);
  const values = Float64Array.from(order, (i) => d[i]);
  let vectors = null;
  if (wantVectors) {
    vectors = new Float64Array(m * m);
    for (let c = 0; c < m; c++) { const src = order[c]; for (let r = 0; r < m; r++) vectors[r * m + c] = a[r * m + src]; }
  }
  return { values, vectors };
}

// ------------------------------------------------------------------ shift-invert block Lanczos

function seededRandom(seed) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296 - 0.5; };
}

/**
 * The lowest `count` eigenvalues of the drum (or as many as converge within maxDim Krylov
 * vectors), and the eigenvectors of the lowest `vectors` of them.
 *   opts: count, vectors (default: count), tol (1e-8: relative residual of an accepted Ritz
 *         pair; the eigenvalue's own relative error is of the order of its square), maxDim,
 *         seed, onProgress(fraction)
 * Returns { values: Float64Array (ascending), vectors: [Float64Array(N)] (Σ φ² h² = 1),
 *           residuals, dim (Krylov dimension used), converged (how many of the lowest values
 *           were accepted), timing }.
 *
 * Blocks of four vectors are stored interleaved (x[4k + r] is component k of vector r): one
 * pass over the Cholesky factor solves for all four, and each earlier block is read once to
 * orthogonalise a whole new block against it, so memory is streamed four times less often than
 * with vector-at-a-time Lanczos.
 */
export function lowestModes(dom, opts = {}) {
  const N = dom.N, P = 4;
  const count = Math.min(opts.count ?? 40, N);
  const wantVec = Math.min(opts.vectors ?? count, count);
  const tol = opts.tol ?? 1e-7;
  if (N < 64) return smallModes(dom, count, wantVec);
  const maxBlocks = Math.floor(Math.min(N / 2, opts.maxDim ?? Math.max(4 * count + 64, 128)) / P);
  const timing = { factor: performance.now(), solve: 0, orth: 0, eig: 0 };
  const fac = factor(dom, 0);
  timing.factor = performance.now() - timing.factor;
  const rand = seededRandom(opts.seed ?? 12345);
  const Q = [];          // blocks, Float64Array(4N) each
  const H = [];          // H[j][i] = the 4x4 block (row-major) of Qᵢᵀ A⁻¹ Qⱼ, i <= j + 1
  const W = new Float64Array(P * N);
  const N4 = 4 * N;

  // C = Qᵢᵀ W and W −= Qᵢ C, accumulating C into acc (16 numbers, row-major).
  function project(Qi, acc) {
    let c00 = 0, c01 = 0, c02 = 0, c03 = 0, c10 = 0, c11 = 0, c12 = 0, c13 = 0;
    let c20 = 0, c21 = 0, c22 = 0, c23 = 0, c30 = 0, c31 = 0, c32 = 0, c33 = 0;
    for (let o = 0; o < N4; o += 4) {
      const q0 = Qi[o], q1 = Qi[o + 1], q2 = Qi[o + 2], q3 = Qi[o + 3];
      const w0 = W[o], w1 = W[o + 1], w2 = W[o + 2], w3 = W[o + 3];
      c00 += q0 * w0; c01 += q0 * w1; c02 += q0 * w2; c03 += q0 * w3;
      c10 += q1 * w0; c11 += q1 * w1; c12 += q1 * w2; c13 += q1 * w3;
      c20 += q2 * w0; c21 += q2 * w1; c22 += q2 * w2; c23 += q2 * w3;
      c30 += q3 * w0; c31 += q3 * w1; c32 += q3 * w2; c33 += q3 * w3;
    }
    for (let o = 0; o < N4; o += 4) {
      const q0 = Qi[o], q1 = Qi[o + 1], q2 = Qi[o + 2], q3 = Qi[o + 3];
      W[o] -= q0 * c00 + q1 * c10 + q2 * c20 + q3 * c30;
      W[o + 1] -= q0 * c01 + q1 * c11 + q2 * c21 + q3 * c31;
      W[o + 2] -= q0 * c02 + q1 * c12 + q2 * c22 + q3 * c32;
      W[o + 3] -= q0 * c03 + q1 * c13 + q2 * c23 + q3 * c33;
    }
    if (acc) {
      acc[0] += c00; acc[1] += c01; acc[2] += c02; acc[3] += c03;
      acc[4] += c10; acc[5] += c11; acc[6] += c12; acc[7] += c13;
      acc[8] += c20; acc[9] += c21; acc[10] += c22; acc[11] += c23;
      acc[12] += c30; acc[13] += c31; acc[14] += c32; acc[15] += c33;
    }
  }
  const colDot = (a, b) => { let s = 0; for (let o = 0; o < N4; o += 4) s += W[o + a] * W[o + b]; return s; };
  const frob = () => { let s = 0; for (let o = 0; o < N4; o++) s += W[o] * W[o]; return Math.sqrt(s); };
  const colAxpy = (r, c, q) => { for (let o = 0; o < N4; o += 4) W[o + r] -= c * W[o + q]; };
  // Orthonormalise the columns of W among themselves (modified Gram-Schmidt, twice), adding the
  // coefficients into R (W_before = Q_new R, R upper triangular, row-major).  A column that
  // comes out (nearly) dependent is replaced by a random direction orthogonal to everything so
  // far, with a zero in R: Lanczos carries on in a new part of the space (deflation).
  function qr(R) {
    for (let r = 0; r < P; r++) {
      const start = Math.sqrt(colDot(r, r));
      for (let pass = 0; pass < 2; pass++) {
        for (let q = 0; q < r; q++) { const c = colDot(q, r); colAxpy(r, c, q); if (R) R[q * P + r] += c; }
      }
      let nr = Math.sqrt(colDot(r, r));
      if (R && nr > 1e-10 * start) R[r * P + r] = nr;
      else if (R || !(nr > 0)) {
        if (R) R[r * P + r] = 0;
        for (let tries = 0; tries < 3; tries++) {
          for (let o = r; o < N4; o += 4) W[o] = rand();
          for (let pass = 0; pass < 2; pass++) {
            for (const Qi of Q) for (let q = 0; q < P; q++) {
              let c = 0;
              for (let o = 0; o < N4; o += 4) c += Qi[o + q] * W[o + r];
              for (let o = 0; o < N4; o += 4) W[o + r] -= c * Qi[o + q];
            }
            for (let q = 0; q < r; q++) colAxpy(r, colDot(q, r), q);
          }
          nr = Math.sqrt(colDot(r, r));
          if (nr > 1e-6) break;
        }
      }
      for (let o = r; o < N4; o += 4) W[o] /= nr;
    }
  }

  for (let o = 0; o < N4; o++) W[o] = rand();
  qr(null);
  Q.push(W.slice());

  let result = null, previous = null;
  let target = Math.min(maxBlocks, Math.max(Math.ceil((2 * count + 40) / P), 3));
  let J = 0; // blocks processed: Q has J + 1 blocks
  for (;;) {
    for (; J < target; J++) {
      let tt = performance.now();
      fac.solve4(Q[J], W);
      timing.solve += performance.now() - tt; tt = performance.now();
      const col = [];
      for (let i = 0; i <= J + 1; i++) col.push(new Float64Array(16));
      // In exact arithmetic A⁻¹Q_J lies along Q_J−1, Q_J and the next block only; rounding
      // brings back the others as Ritz vectors converge.  So: project out the last two blocks,
      // then every block once more (block classical Gram-Schmidt), and once again if that pass
      // removed much (the Daniel-Gragg-Kaufman-Stewart test).
      for (let i = Math.max(0, J - 1); i <= J; i++) project(Q[i], col[i]);
      let before = frob();
      for (let pass = 0; pass < 2; pass++) {
        for (let i = 0; i <= J; i++) project(Q[i], col[i]);
        const after = frob();
        if (after > 0.5 * before) break;
        before = after;
      }
      qr(col[J + 1]);
      Q.push(W.slice());
      H.push(col);
      timing.orth += performance.now() - tt;
      if (opts.onProgress) opts.onProgress(Math.min(0.95, (J + 1) / target));
    }
    const m = J * P;
    // The Rayleigh quotient T = Qᵀ A⁻¹ Q: block tridiagonal (symmetrised), and its eigenpairs.
    const T = new Float64Array(m * m);
    for (let j = 0; j < J; j++) {
      for (let i = Math.max(0, j - 1); i <= Math.min(j + 1, J - 1); i++) {
        const B = H[j][i];
        for (let r = 0; r < P; r++) for (let c = 0; c < P; c++) T[(i * P + r) * m + j * P + c] = B[r * P + c];
      }
    }
    for (let r = 0; r < m; r++) for (let c = r + 1; c < m; c++) {
      const v = 0.5 * (T[r * m + c] + T[c * m + r]);
      T[r * m + c] = v; T[c * m + r] = v;
    }
    const te = performance.now();
    // Without eigenvectors to return, the dense eigenvectors of T (the costly part for large m)
    // are skipped: a Ritz value is accepted when it has stopped moving since the last Rayleigh-
    // Ritz step, 16 or more blocks earlier (Ritz values only rise towards the eigenvalues of A⁻¹,
    // and do so steadily until they converge).
    const valuesOnly = wantVec === 0;
    const { values: theta, vectors: Y } = symmetricEigen(T, m, !valuesOnly);
    timing.eig += performance.now() - te;
    const ritz = [];
    if (valuesOnly) {
      for (let c = m - 1; c >= 0; c--) {
        if (!(theta[c] > 0)) continue;
        const k = ritz.length, old = previous ? previous[k] : NaN;
        ritz.push({ lambda: 1 / theta[c], rel: Math.abs(old * theta[c] - 1), col: c });
      }
      previous = ritz.map((r) => r.lambda);
    } else {
      // Residuals: A⁻¹x − θx = Q_J R y_last, with R = H[J−1][J] the coupling to the next block.
      const R = H[J - 1][J];
      for (let c = m - 1; c >= 0; c--) {
        const th = theta[c];
        if (!(th > 0)) continue;
        let res2 = 0;
        for (let r = 0; r < P; r++) {
          let s = 0;
          for (let q = 0; q < P; q++) s += R[r * P + q] * Y[((J - 1) * P + q) * m + c];
          res2 += s * s;
        }
        ritz.push({ lambda: 1 / th, rel: Math.sqrt(res2) / th, col: c });
      }
    }
    let conv = 0;
    while (conv < ritz.length && ritz[conv].rel < (valuesOnly ? 1e-11 : tol)) conv++;
    if (conv >= count || J >= maxBlocks) {
      const k = Math.min(count, conv);
      const values = Float64Array.from(ritz.slice(0, k), (r) => r.lambda);
      const residuals = Float64Array.from(ritz.slice(0, k), (r) => r.rel);
      const vecs = [];
      const h = dom.h;
      for (let v = 0; v < Math.min(wantVec, k); v++) {
        const c = ritz[v].col, x = new Float64Array(N);
        for (let b = 0; b < J; b++) {
          const Qb = Q[b];
          const y0 = Y[(b * P) * m + c], y1 = Y[(b * P + 1) * m + c], y2 = Y[(b * P + 2) * m + c], y3 = Y[(b * P + 3) * m + c];
          for (let kk = 0, o = 0; kk < N; kk++, o += 4) x[kk] += y0 * Qb[o] + y1 * Qb[o + 1] + y2 * Qb[o + 2] + y3 * Qb[o + 3];
        }
        // Normalise to Σ φ² h² = 1, and fix the sign: the largest value positive.
        let s = 0, big = 0;
        for (let kk = 0; kk < N; kk++) { s += x[kk] * x[kk]; if (Math.abs(x[kk]) > Math.abs(big)) big = x[kk]; }
        const f = (big < 0 ? -1 : 1) / Math.sqrt(s * h * h);
        for (let kk = 0; kk < N; kk++) x[kk] *= f;
        vecs.push(x);
      }
      result = { values, vectors: vecs, residuals, dim: m, converged: conv, timing };
      break;
    }
    target = Math.min(maxBlocks, target + Math.max(4, Math.ceil(count / (4 * P))));
  }
  opts.onProgress?.(1);
  return result;
}

/** A tiny domain: the dense eigenproblem. */
function smallModes(dom, count, wantVec) {
  const N = dom.N, A = new Float64Array(N * N), x = new Float64Array(N), y = new Float64Array(N);
  for (let c = 0; c < N; c++) { x.fill(0); x[c] = 1; applyLaplacian(dom, x, y); for (let r = 0; r < N; r++) A[r * N + c] = y[r]; }
  const { values, vectors } = N ? symmetricEigen(A, N, true) : { values: new Float64Array(0), vectors: null };
  const k = Math.min(count, N), vecs = [];
  for (let v = 0; v < Math.min(wantVec, k); v++) {
    const z = new Float64Array(N);
    let big = 0;
    for (let r = 0; r < N; r++) { z[r] = vectors[r * N + v] / dom.h; if (Math.abs(z[r]) > Math.abs(big)) big = z[r]; }
    if (big < 0) for (let r = 0; r < N; r++) z[r] = -z[r];
    vecs.push(z);
  }
  return { values: values.slice(0, k), vectors: vecs, residuals: new Float64Array(k), dim: N, converged: k, timing: {} };
}

/** Scatter a free-point vector into a grid array (zero on the walls). */
export function toGrid(dom, x, out = new Float64Array(dom.n * dom.n)) {
  out.fill(0);
  for (let k = 0; k < dom.N; k++) out[dom.pts[k]] = x[k];
  return out;
}

/** Gather a grid array at the free points. */
export function fromGrid(dom, g, out = new Float64Array(dom.N)) {
  for (let k = 0; k < dom.N; k++) out[k] = g[dom.pts[k]];
  return out;
}
