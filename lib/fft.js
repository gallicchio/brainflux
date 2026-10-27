// Fast Fourier transforms on split real/imaginary arrays.
//
// Radix-2 Cooley-Tukey, in place: the data are first put in bit-reversed order, then
// log2(n) passes of "butterflies" combine transforms of length 2, 4, 8, ... n.  Lengths must
// be powers of two.  Twiddle factors and the bit-reversal table are computed once per length.
//
// Conventions (the physicist's, as in the demos):
//   forward  F[k] = sum_x f[x] exp(-2 pi i k x / n)
//   inverse  f[x] = (1/n) sum_k F[k] exp(+2 pi i k x / n)
// The "centred, unitary" versions used by the demos put x = 0 and k = 0 in the middle of the
// array (index n/2) and scale by 1/sqrt(n) both ways, so that Parseval's theorem reads
// sum |f|^2 = sum |F|^2 and both sides can be drawn with the same brightness scale.

const plans = new Map();

function plan(n) {
  let p = plans.get(n);
  if (p) return p;
  if (n < 1 || (n & (n - 1)) !== 0) throw new Error(`FFT length ${n} is not a power of two`);
  const bits = Math.round(Math.log2(n));
  const rev = new Uint32Array(n);
  for (let i = 1; i < n; i++) rev[i] = (rev[i >> 1] >> 1) | ((i & 1) << (bits - 1));
  const half = n >> 1;
  const cos = new Float64Array(half), sin = new Float64Array(half);
  for (let k = 0; k < half; k++) {
    cos[k] = Math.cos((2 * Math.PI * k) / n);
    sin[k] = Math.sin((2 * Math.PI * k) / n);
  }
  p = { n, rev, cos, sin, tmpRe: new Float64Array(n), tmpIm: new Float64Array(n) };
  plans.set(n, p);
  return p;
}

// The core: transform n values of re/im starting at `offset`.  sign = -1 forward, +1 inverse
// (no 1/n here; callers scale).
function transform(re, im, n, offset, sign) {
  const { rev, cos, sin } = plan(n);
  if (n < 2) return;
  for (let i = 0; i < n; i++) {
    const j = rev[i];
    if (j > i) {
      const a = offset + i, b = offset + j;
      let t = re[a]; re[a] = re[b]; re[b] = t;
      t = im[a]; im[a] = im[b]; im[b] = t;
    }
  }
  // Length-2 butterflies need no multiplications.
  for (let a = offset, end = offset + n; a < end; a += 2) {
    const b = a + 1;
    const tr = re[b], ti = im[b];
    re[b] = re[a] - tr; im[b] = im[a] - ti;
    re[a] += tr; im[a] += ti;
  }
  for (let size = 4; size <= n; size <<= 1) {
    const half = size >> 1, step = n / size;
    for (let start = offset, end = offset + n; start < end; start += size) {
      for (let j = 0, k = 0; j < half; j++, k += step) {
        const wr = cos[k], wi = sign * sin[k];
        const a = start + j, b = a + half;
        const tr = wr * re[b] - wi * im[b];
        const ti = wr * im[b] + wi * re[b];
        re[b] = re[a] - tr; im[b] = im[a] - ti;
        re[a] += tr; im[a] += ti;
      }
    }
  }
}

function scale(re, im, s) {
  for (let i = 0; i < re.length; i++) { re[i] *= s; im[i] *= s; }
}

/** Forward transform of the whole array, in place, unnormalised. */
export function fft(re, im) { transform(re, im, re.length, 0, -1); }

/** Inverse transform of the whole array, in place, with the 1/n. */
export function ifft(re, im) {
  transform(re, im, re.length, 0, +1);
  scale(re, im, 1 / re.length);
}

/**
 * 2D transform of an nx-by-ny array stored row by row (index = y * nx + x), in place.
 * sign = -1 forward, +1 inverse; unnormalised either way.
 */
export function fft2(re, im, nx, ny, sign = -1) {
  for (let y = 0; y < ny; y++) transform(re, im, nx, y * nx, sign);
  const p = plan(ny), cr = p.tmpRe, ci = p.tmpIm;
  for (let x = 0; x < nx; x++) {
    for (let y = 0, i = x; y < ny; y++, i += nx) { cr[y] = re[i]; ci[y] = im[i]; }
    transform(cr, ci, ny, 0, sign);
    for (let y = 0, i = x; y < ny; y++, i += nx) { re[i] = cr[y]; im[i] = ci[y]; }
  }
}

// Multiplying by (-1)^x before and after a transform moves index 0 to index n/2, which is
// fftshift without copying: with x' = x - n/2 and k' = k - n/2,
//   exp(-2 pi i k' x' / n) = exp(-2 pi i k x / n) (-1)^x (-1)^k (-1)^(n/2)
// and (-1)^(n/2) = 1 whenever n is a multiple of 4.
function checkerboard1(re, im) {
  for (let i = 1; i < re.length; i += 2) { re[i] = -re[i]; im[i] = -im[i]; }
}

function checkerboard2(re, im, nx, ny) {
  for (let y = 0; y < ny; y++) {
    for (let x = (y & 1) ? 0 : 1, i = y * nx + x; x < nx; x += 2, i += 2) {
      re[i] = -re[i]; im[i] = -im[i];
    }
  }
}

/** Centred, unitary 1D transform in place: index n/2 is x = 0 (and k = 0). */
export function fftCentered(re, im, inverse = false) {
  const n = re.length;
  if (n % 4) throw new Error('centred FFT needs a length that is a multiple of 4');
  checkerboard1(re, im);
  transform(re, im, n, 0, inverse ? +1 : -1);
  checkerboard1(re, im);
  scale(re, im, 1 / Math.sqrt(n));
}

/** Centred, unitary 2D transform in place: pixel (nx/2, ny/2) is the origin on both sides. */
export function fft2Centered(re, im, nx, ny, inverse = false) {
  if (nx % 4 || ny % 4) throw new Error('centred FFT needs sizes that are multiples of 4');
  checkerboard2(re, im, nx, ny);
  fft2(re, im, nx, ny, inverse ? +1 : -1);
  checkerboard2(re, im, nx, ny);
  scale(re, im, 1 / Math.sqrt(nx * ny));
}

/**
 * Angular wavenumbers of an n-point periodic grid with spacing dx, in FFT order
 * (0, 1, ..., n/2 - 1, -n/2, ..., -1) times 2 pi / (n dx).
 */
export function wavenumbers(n, dx) {
  const k = new Float64Array(n), dk = (2 * Math.PI) / (n * dx);
  for (let i = 0; i < n; i++) k[i] = (i < n / 2 ? i : i - n) * dk;
  return k;
}

/** Direct O(n^2) DFT, for the tests. */
export function dft(re, im, sign = -1) {
  const n = re.length, outRe = new Float64Array(n), outIm = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    let sr = 0, si = 0;
    for (let x = 0; x < n; x++) {
      const a = (sign * 2 * Math.PI * ((k * x) % n)) / n;
      const c = Math.cos(a), s = Math.sin(a);
      sr += re[x] * c - im[x] * s;
      si += re[x] * s + im[x] * c;
    }
    outRe[k] = sr; outIm[k] = si;
  }
  return [outRe, outIm];
}
