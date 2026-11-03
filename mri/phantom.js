// The things that are imaged: tissues with their proton density, T1 and T2; a head-like phantom
// of ellipses and a few disks you can drag; the phantom rasterized onto the grid of pixels the
// scanner uses, as the fraction of each pixel that each tissue fills; and the weighting that a
// pulse sequence (its TR, TE, flip angle) gives each tissue.  No DOM: the tests import this.
//
// Lengths are in mm, times in ms.  The picture's grid is N x N pixels of side dx = fov / N:
// pixel (i, j), column i and row j, is centred on x = (i - N/2) dx, y = (N/2 - j) dx, so y
// points up and the centre of the field of view is pixel (N/2, N/2), the origin of the centred
// FFT in lib/fft.js.

// Tissues at 1.5 T (typical textbook values; T1 lengthens at 3 T, T2 hardly changes).
// rho: the proton density relative to water.  colour: how the tissue is drawn in sketches.
export const TISSUES = {
  water: { label: 'water (CSF)', rho: 1.0, T1: 4000, T2: 2000, T1at3T: 4300, colour: '#5aa9ff' },
  fat: { label: 'fat', rho: 0.95, T1: 260, T2: 80, T1at3T: 370, colour: '#ffcf5a' },
  grey: { label: 'grey matter', rho: 0.8, T1: 950, T2: 100, T1at3T: 1330, colour: '#9c9c9c' },
  white: { label: 'white matter', rho: 0.7, T1: 650, T2: 90, T1at3T: 830, colour: '#e0e0e0' },
  lesion: { label: 'lesion (oedema)', rho: 0.9, T1: 1200, T2: 200, T1at3T: 1600, colour: '#ff7a9a' },
  bone: { label: 'bone (no signal)', rho: 0, T1: 1, T2: 1, T1at3T: 1, colour: '#303030' },
};
export const TISSUE_NAMES = Object.keys(TISSUES);
/** The tissues with their signal; bone (no protons that the scanner sees) left out. */
export const SIGNAL_TISSUES = TISSUE_NAMES.filter((t) => TISSUES[t].rho > 0);

/** A tissue's T1 and T2 at the field B0 (T): 1.5 T values, or the 3 T ones above 2.2 T. */
export function tissueAt(name, B0 = 1.5) {
  const t = TISSUES[name];
  return { ...t, name, T1: B0 > 2.2 ? t.T1at3T : t.T1 };
}

// Shapes: {x, y, a, b, phi, tissue}: an ellipse centred on (x, y), semi-axis a along the
// direction phi (radians from the x axis), b across it, filled with the tissue; later shapes
// cover earlier ones.  A disk is an ellipse with a = b.
export const ellipse = (x, y, a, b, phiDeg, tissue) => ({ x, y, a, b, phi: (phiDeg * Math.PI) / 180, tissue });
export const disk = (x, y, R, tissue) => ellipse(x, y, R, R, 0, tissue);

/** A head seen from above, in the spirit of the Shepp-Logan phantom: scalp fat, skull, CSF,
 *  cortex, white matter, two ventricles, a lesion.  About 190 x 220 mm. */
export function headPhantom() {
  return [
    ellipse(0, 0, 95, 110, 0, 'fat'),       // scalp
    ellipse(0, 0, 88, 103, 0, 'bone'),      // skull
    ellipse(0, 0, 82, 97, 0, 'water'),      // cerebrospinal fluid
    ellipse(0, -2, 78, 92, 0, 'grey'),      // cortex
    ellipse(0, -4, 66, 80, 0, 'white'),     // white matter
    ellipse(-22, 8, 11, 32, 15, 'water'),   // left ventricle
    ellipse(22, 8, 11, 32, -15, 'water'),   // right ventricle
    ellipse(38, -38, 12, 9, 20, 'lesion'),  // a lesion
    ellipse(-40, 52, 7, 7, 0, 'fat'),       // a pocket of fat
  ];
}

/** Three disks: water, fat and white matter (drag them). */
export function disksPhantom() {
  return [disk(-45, 22, 32, 'water'), disk(42, 36, 24, 'fat'), disk(8, -42, 36, 'white')];
}

/** The extent of a list of shapes: [xmin, xmax, ymin, ymax] in mm. */
export function shapesExtent(shapes) {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const s of shapes) {
    const c = Math.cos(s.phi), sn = Math.sin(s.phi);
    const ex = Math.hypot(s.a * c, s.b * sn), ey = Math.hypot(s.a * sn, s.b * c);
    x0 = Math.min(x0, s.x - ex); x1 = Math.max(x1, s.x + ex); y0 = Math.min(y0, s.y - ey); y1 = Math.max(y1, s.y + ey);
  }
  return [x0, x1, y0, y1];
}

/** The tissue at the point (x, y): the last shape that contains it, or null. */
export function tissueAtPoint(shapes, x, y) {
  let t = null;
  for (const s of shapes) {
    const dx = x - s.x, dy = y - s.y, c = Math.cos(s.phi), sn = Math.sin(s.phi);
    const u = (dx * c + dy * sn) / s.a, w = (-dx * sn + dy * c) / s.b;
    if (u * u + w * w <= 1) t = s.tissue;
  }
  return t;
}

/**
 * Rasterize shapes onto a grid: nx columns by ny rows of pixels of side dx (mm), centred on the
 * origin, each pixel sampled ss x ss times, giving for each tissue the fraction of each pixel it
 * fills (Float32Array nx * ny, row-major, y up).  A pixel wholly inside or outside a shape is
 * decided from its centre; only the ones an edge crosses are sub-sampled.
 */
export function rasterize(shapes, nx, ny, dx, ss = 4) {
  const fills = {};
  for (const t of TISSUE_NAMES) if (shapes.some((s) => s.tissue === t)) fills[t] = new Float32Array(nx * ny);
  const idx = Object.fromEntries(TISSUE_NAMES.map((t, i) => [t, i]));
  const pre = shapes.map((s) => ({ ...s, c: Math.cos(s.phi), sn: Math.sin(s.phi), ia: 1 / s.a, ib: 1 / s.b, t: idx[s.tissue] }));
  const classAt = (x, y) => {
    let t = -1;
    for (const s of pre) {
      const ddx = x - s.x, ddy = y - s.y, u = (ddx * s.c + ddy * s.sn) * s.ia, w = (-ddx * s.sn + ddy * s.c) * s.ib;
      if (u * u + w * w <= 1) t = s.t;
    }
    return t;
  };
  // Does an edge come within half a pixel's diagonal of (x, y)?  (A cheap, safe test: the
  // distance to the ellipse in its scaled coordinates, times the smaller semi-axis.)
  const near = (x, y) => {
    const r = 0.75 * dx;
    for (const s of pre) {
      const ddx = x - s.x, ddy = y - s.y, u = (ddx * s.c + ddy * s.sn) * s.ia, w = (-ddx * s.sn + ddy * s.c) * s.ib;
      const q = Math.sqrt(u * u + w * w);
      if (Math.abs(q - 1) * Math.min(s.a, s.b) <= r) return true;
    }
    return false;
  };
  const names = TISSUE_NAMES, inv = 1 / (ss * ss);
  for (let j = 0; j < ny; j++) {
    const y = (ny / 2 - j - 0.5) * dx;
    for (let i = 0; i < nx; i++) {
      const x = (i - nx / 2 + 0.5) * dx, o = j * nx + i;
      if (!near(x, y)) {
        const t = classAt(x, y);
        if (t >= 0) fills[names[t]][o] = 1;
        continue;
      }
      for (let q = 0; q < ss; q++) {
        const yy = y + ((q + 0.5) / ss - 0.5) * dx;
        for (let p = 0; p < ss; p++) {
          const t = classAt(x + ((p + 0.5) / ss - 0.5) * dx, yy);
          if (t >= 0) fills[names[t]][o] += inv;
        }
      }
    }
  }
  return { nx, ny, dx, fills };
}

// ------------------------------------------------------------------------- weighting

/**
 * The signal a tissue gives, per unit proton density, in a spoiled sequence repeated every TR
 * with flip angle alpha (radians) and echo time TE:
 *     sin(alpha) (1 - E1) / (1 - E1 cos(alpha)) * exp(-TE / T2),   E1 = exp(-TR / T1),
 * with T2 for a spin echo (the pi pulse refocuses the field's spread) and T2* for a gradient
 * echo, 1/T2* = 1/T2 + 1/T2prime (T2prime: the dephasing by the uneven field).  For alpha =
 * pi/2 this is the textbook (1 - e^{-TR/T1}) e^{-TE/T2}.
 */
export function weighting(tissue, seq) {
  const { TR, TE, type = 'se', alpha = Math.PI / 2, T2prime = 40 } = seq;
  const E1 = Math.exp(-TR / tissue.T1);
  const T2eff = type === 'gre' ? 1 / (1 / tissue.T2 + 1 / T2prime) : tissue.T2;
  return (Math.sin(alpha) * (1 - E1)) / (1 - E1 * Math.cos(alpha)) * Math.exp(-TE / T2eff);
}

/** The longitudinal magnetization just before each pulse, in the steady state, per unit rho. */
export function steadyMz(tissue, seq) {
  const { TR, alpha = Math.PI / 2 } = seq;
  const E1 = Math.exp(-TR / tissue.T1);
  return (1 - E1) / (1 - E1 * Math.cos(alpha));
}

/**
 * The weighted picture m(x, y) = sum over tissues of (fraction) rho w, as Float64Array, and the
 * part of it that is fat (for the chemical shift), from a rasterization and the sequence; B0
 * picks the T1 values.  weights: the weight of each tissue, for readouts.
 */
export function weightedImage(raster, seq, B0 = 1.5) {
  const { nx, ny, fills } = raster, n = nx * ny;
  const total = new Float64Array(n), fat = new Float64Array(n), weights = {};
  for (const [name, f] of Object.entries(fills)) {
    const t = tissueAt(name, B0);
    if (!(t.rho > 0)) continue;
    const w = t.rho * weighting(t, seq);
    weights[name] = w;
    const into = name === 'fat' ? fat : total;
    for (let i = 0; i < n; i++) into[i] += w * f[i];
  }
  for (let i = 0; i < n; i++) total[i] += fat[i];
  return { total, fat, weights };
}

/**
 * The projection of a picture (nx by ny, pixel dx) onto the direction theta: the sum of the
 * picture along lines s = x cos(theta) + y sin(theta) = const, deposited into M bins of width
 * ds centred on s = 0 (linear interpolation between bins; the integral over s equals the sum of
 * the picture times dx^2).  This is what the spectrum of the FID under a gradient along theta
 * shows, with s = f / (gamma-bar G).
 */
export function projection(img, nx, ny, dx, theta, M, ds, ss = 4) {
  const out = new Float64Array(M), c = Math.cos(theta), sn = Math.sin(theta);
  // Each pixel is split ss x ss ways and each piece dropped into the bin it falls in, so that
  // along the axes a projection is exactly the pixel sums and at other angles it is smooth.
  const w = (dx * dx) / (ss * ss) / ds;
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const v = img[j * nx + i];
      if (v === 0) continue;
      for (let q = 0; q < ss; q++) {
        const y = (ny / 2 - j - 0.5 + ((q + 0.5) / ss - 0.5)) * dx;
        for (let p = 0; p < ss; p++) {
          const x = (i - nx / 2 + 0.5 + ((p + 0.5) / ss - 0.5)) * dx;
          const k = Math.floor((x * c + y * sn) / ds + M / 2);
          if (k >= 0 && k < M) out[k] += v * w;
        }
      }
    }
  }
  return out;
}
