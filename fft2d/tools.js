// Editing an n x n complex image (split re/im arrays, row-major, origin at (n/2, n/2)).
// Everything wraps around the edges: the discrete Fourier transform treats an image as one tile
// of a periodic wallpaper, so painting off the right edge comes back on the left.

const wrap = (i, n) => ((i % n) + n) % n;

/**
 * Stamp one brush mark centred on pixel (cx, cy).
 *   brush.shape  'round' | 'square' | 'soft'
 *   brush.size   diameter in pixels (1 = a single pixel)
 *   vr, vi       the complex value painted (0, 0 erases)
 * Hard brushes set the value; the soft brush blends towards it with a Gaussian weight, like an
 * airbrush.
 */
export function stamp(re, im, n, cx, cy, brush, vr, vi) {
  const size = Math.max(1, brush.size);
  cx = Math.round(cx); cy = Math.round(cy);
  if (brush.shape === 'soft') {
    const sigma = size / 4, reach = Math.ceil(2.5 * sigma), k = 1 / (2 * sigma * sigma);
    for (let dy = -reach; dy <= reach; dy++) {
      const row = wrap(cy + dy, n) * n;
      for (let dx = -reach; dx <= reach; dx++) {
        const w = Math.exp(-(dx * dx + dy * dy) * k) * brush.strength;
        if (w < 1e-3) continue;
        const i = row + wrap(cx + dx, n);
        re[i] += (vr - re[i]) * w;
        im[i] += (vi - im[i]) * w;
      }
    }
    return;
  }
  // Hard brushes: pixel centres within the shape.  Even sizes are centred half a pixel off.
  const lo = -Math.floor((size - 1) / 2), hi = Math.floor(size / 2);
  const c = (lo + hi) / 2, r2 = (size / 2) ** 2;
  for (let dy = lo; dy <= hi; dy++) {
    const row = wrap(cy + dy, n) * n;
    for (let dx = lo; dx <= hi; dx++) {
      if (brush.shape === 'round' && size > 2 && (dx - c) ** 2 + (dy - c) ** 2 > r2) continue;
      const i = row + wrap(cx + dx, n);
      re[i] = vr; im[i] = vi;
    }
  }
}

/**
 * Stamp with the options that make painting teach something:
 *   repeat  m > 1 stamps the same mark on an m x m lattice of points n/m apart (convolution of
 *           the mark with a comb; on the other side, only every m-th frequency survives)
 *   mirror  also stamps the conjugate value at the mirror point -r (Hermitian symmetry: then
 *           the other side stays real)
 */
export function paint(re, im, n, cx, cy, brush, vr, vi, { repeat = 1, mirror = false } = {}) {
  const step = n / repeat;
  for (let a = 0; a < repeat; a++) {
    for (let b = 0; b < repeat; b++) {
      const x = wrap(cx + a * step, n), y = wrap(cy + b * step, n);
      stamp(re, im, n, x, y, brush, vr, vi);
      if (mirror) stamp(re, im, n, wrap(n - x, n), wrap(n - y, n), brush, vr, -vi);
    }
  }
}

/** Paint along the segment from (x0, y0) to (x1, y1), spacing the stamps about size/3 apart. */
export function stroke(re, im, n, x0, y0, x1, y1, brush, vr, vi, opts) {
  const d = Math.hypot(x1 - x0, y1 - y0);
  const spacing = Math.max(0.5, brush.size / 3);
  const steps = Math.max(1, Math.ceil(d / spacing));
  for (let s = 1; s <= steps; s++) {
    const x = Math.round(x0 + ((x1 - x0) * s) / steps), y = Math.round(y0 + ((y1 - y0) * s) / steps);
    paint(re, im, n, x, y, brush, vr, vi, opts);
  }
}

/**
 * A mask: zero everything outside (keep = 'inside') or inside (keep = 'outside') a disk or a
 * square of the given radius centred on (cx, cy).  Centred on k = 0, 'inside' is an ideal
 * low-pass filter and 'outside' an ideal high-pass filter.  With mirror, the mask and its
 * mirror image are combined (kept if either keeps it), so the other side stays real.
 */
export function mask(re, im, n, cx, cy, radius, shape, keep, mirror = false) {
  const inside = (x, y, mx, my) => {
    let dx = x - mx, dy = y - my;
    // Shortest distance on the torus, so a mask near an edge wraps.
    dx -= n * Math.round(dx / n); dy -= n * Math.round(dy / n);
    return shape === 'square' ? Math.max(Math.abs(dx), Math.abs(dy)) <= radius : dx * dx + dy * dy <= radius * radius;
  };
  const mx = wrap(n - cx, n), my = wrap(n - cy, n);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      let isIn = inside(x, y, cx, cy);
      if (mirror && !isIn) isIn = inside(x, y, mx, my);
      if ((keep === 'inside') !== isIn) { const i = y * n + x; re[i] = 0; im[i] = 0; }
    }
  }
}

/** Copy src shifted by (dx, dy) pixels, wrapping around, into dst. */
export function roll(srcRe, srcIm, dstRe, dstIm, n, dx, dy) {
  dx = wrap(Math.round(dx), n); dy = wrap(Math.round(dy), n);
  for (let y = 0; y < n; y++) {
    const from = y * n, to = wrap(y + dy, n) * n;
    for (let x = 0; x < n; x++) {
      const j = to + wrap(x + dx, n);
      dstRe[j] = srcRe[from + x]; dstIm[j] = srcIm[from + x];
    }
  }
}

/** The operations that change the data (not just the display). */
export const OPERATIONS = {
  magnitude: {
    label: 'Keep only the magnitude',
    title: 'Throw away the phase: every pixel becomes its magnitude, a positive real number',
    run(re, im) { for (let i = 0; i < re.length; i++) { re[i] = Math.hypot(re[i], im[i]); im[i] = 0; } },
  },
  phase: {
    label: 'Keep only the phase',
    title: 'Throw away the magnitude: every non-zero pixel gets the same magnitude (the r.m.s. value, so the total power is unchanged) and keeps its phase',
    run(re, im) {
      let sum = 0, count = 0;
      for (let i = 0; i < re.length; i++) { const m2 = re[i] * re[i] + im[i] * im[i]; if (m2 > 0) { sum += m2; count++; } }
      const rms = count ? Math.sqrt(sum / re.length) : 0;
      for (let i = 0; i < re.length; i++) {
        const m = Math.hypot(re[i], im[i]);
        if (m > 0) { re[i] *= rms / m; im[i] *= rms / m; }
      }
    },
  },
  real: {
    label: 'Keep only the real part',
    title: 'Set the imaginary part to zero: the other side becomes Hermitian, F(-k) = F(k)*',
    run(re, im) { im.fill(0); },
  },
  imag: {
    label: 'Keep only the imaginary part',
    title: 'Set the real part to zero (the imaginary part stays imaginary): the other side becomes anti-Hermitian, F(-k) = -F(k)*',
    run(re, im) { re.fill(0); },
  },
  conjugate: {
    label: 'Complex conjugate',
    title: 'f -> f*: the other side is mirrored through the origin and conjugated',
    run(re, im) { for (let i = 0; i < im.length; i++) im[i] = -im[i]; },
  },
  symmetrize: {
    label: 'Make it Hermitian',
    title: 'Replace f(r) by [f(r) + f(-r)*]/2: then the other side is exactly real',
    run(re, im, n) {
      const r2 = re.slice(), i2 = im.slice();
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        const i = y * n + x, j = wrap(n - y, n) * n + wrap(n - x, n);
        re[i] = (r2[i] + r2[j]) / 2; im[i] = (i2[i] - i2[j]) / 2;
      }
    },
  },
  clear: {
    label: 'Clear',
    title: 'Set everything to zero',
    run(re, im) { re.fill(0); im.fill(0); },
  },
};

/** |a| with the phase of b, or the phase of a with |b|, into a. */
export function graft(re, im, memRe, memIm, keep) {
  for (let i = 0; i < re.length; i++) {
    const ma = Math.hypot(re[i], im[i]), mb = Math.hypot(memRe[i], memIm[i]);
    if (keep === 'magnitude') {
      // This magnitude, the remembered phase.
      if (mb > 0) { re[i] = (ma * memRe[i]) / mb; im[i] = (ma * memIm[i]) / mb; } else { re[i] = ma; im[i] = 0; }
    } else {
      // This phase, the remembered magnitude.
      if (ma > 0) { re[i] = (mb * re[i]) / ma; im[i] = (mb * im[i]) / ma; } else { re[i] = mb; im[i] = 0; }
    }
  }
}

/** Resample an n x n complex image to m x m (bilinear, periodic). */
export function resample(re, im, n, m) {
  const outRe = new Float64Array(m * m), outIm = new Float64Array(m * m);
  const s = n / m;
  for (let y = 0; y < m; y++) {
    const fy = (y + 0.5) * s - 0.5, y0 = Math.floor(fy), ty = fy - y0;
    for (let x = 0; x < m; x++) {
      const fx = (x + 0.5) * s - 0.5, x0 = Math.floor(fx), tx = fx - x0;
      const i00 = wrap(y0, n) * n + wrap(x0, n), i01 = wrap(y0, n) * n + wrap(x0 + 1, n);
      const i10 = wrap(y0 + 1, n) * n + wrap(x0, n), i11 = wrap(y0 + 1, n) * n + wrap(x0 + 1, n);
      const o = y * m + x;
      outRe[o] = (re[i00] * (1 - tx) + re[i01] * tx) * (1 - ty) + (re[i10] * (1 - tx) + re[i11] * tx) * ty;
      outIm[o] = (im[i00] * (1 - tx) + im[i01] * tx) * (1 - ty) + (im[i10] * (1 - tx) + im[i11] * tx) * ty;
    }
  }
  return [outRe, outIm];
}
