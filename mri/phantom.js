// The things that are imaged: tissues with their proton density, T1 and T2; a head-like phantom
// of ellipses and a few disks you can drag; the phantom rasterized onto the grid of pixels the
// scanner uses, as the fraction of each pixel that each tissue fills; and the weighting that a
// pulse sequence (its TR, TE, flip angle) gives each tissue.  No DOM: the tests import this.
//
// Lengths are in mm, times in ms.  The picture's grid is N x N pixels of side dx = fov / N:
// pixel (i, j), column i and row j, is centred on x = (i - N/2) dx, y = (N/2 - j) dx, so y
// points up and the centre of the field of view is pixel (N/2, N/2), the origin of the centred
// FFT in lib/fft.js.

// Tissues at 1.5 T (typical textbook values; T1 lengthens at 3 T, T2 hardly changes), and at
// 50 mT, measured in heads (O'Reilly and Webb, Magn. Reson. Med. 87, 884, 2022: grey matter
// 327 ms, white 275, CSF 3695, fat 130; their T2s are within a few percent of these).  The
// lesion's low-field T1 is a guess: grey matter's ratio.  rho: the proton density relative to
// water.  colour: how the tissue is drawn in sketches.
// The tubes of a low-field phantom, as the NMR demo has them at 46 µT: tap water, water with a
// little copper sulphate (whose ions shorten T1 and T2), and cooking oil.  Water's relaxation
// hardly depends on the field (its molecules tumble in picoseconds, faster than any Larmor
// period here): `fixed`.  Oil's T1 shortens at low field, as fat's does (T1earth: in the board's
// polarizing field of 7.84 mT, the NMR demo's 0.1 s).  `shift`: the tissue turns 3.4 ppm slower
// than water (fat, oil), which the readout reads as a shift along x.
export const TISSUES = {
  water: { label: 'water (CSF)', rho: 1.0, T1: 4000, T2: 2000, T1at3T: 4300, T1lo: 3695, colour: '#5aa9ff' },
  fat: { label: 'fat', rho: 0.95, T1: 260, T2: 80, T1at3T: 370, T1lo: 130, colour: '#ffcf5a', shift: true },
  grey: { label: 'grey matter', rho: 0.8, T1: 950, T2: 100, T1at3T: 1330, T1lo: 327, colour: '#9c9c9c' },
  white: { label: 'white matter', rho: 0.7, T1: 650, T2: 90, T1at3T: 830, T1lo: 275, colour: '#e0e0e0' },
  lesion: { label: 'lesion (oedema)', rho: 0.9, T1: 1500, T2: 200, T1at3T: 2000, T1lo: (1500 * 327) / 950, colour: '#ff7a9a' },
  bone: { label: 'bone (no signal)', rho: 0, T1: 1, T2: 1, T1at3T: 1, T1lo: 1, colour: '#303030' },
  tap: { label: 'tap water', rho: 1.0, T1: 2500, T2: 2000, fixed: true, colour: '#5aa9ff' },
  cuso4: { label: 'water + CuSO₄', rho: 1.0, T1: 300, T2: 250, fixed: true, colour: '#3fd0c8' },
  oil: { label: 'oil', rho: 0.95, T1: 260, T2: 80, T1at3T: 370, T1lo: 130, T1earth: 100, colour: '#ffcf5a', shift: true },
};
export const TISSUE_NAMES = Object.keys(TISSUES);
/** The tissues with their signal; bone (no protons that the scanner sees) left out. */
export const SIGNAL_TISSUES = TISSUE_NAMES.filter((t) => TISSUES[t].rho > 0);

/** The field (T) of the low-field values T1lo. */
export const B_LO = 0.05;

/**
 * A tissue's T1 and T2 at the field B0 (T).  At 1.5 T and 3 T the values above; between 50 mT
 * and 1.5 T a power of the field through the 50 mT and 1.5 T values, T1 = T1lo (B0 / 50 mT)^b
 * (tissue T1 grows roughly as a power of the frequency: the dispersion of relaxation); in the
 * Earth's field, what matters is T1 while the board's coil polarizes (7.84 mT): T1earth, or the
 * 50 mT value.  Water and copper sulphate (fixed) are the same at every field.  T2 is kept.
 */
export function tissueAt(name, B0 = 1.5) {
  const t = TISSUES[name];
  let T1 = t.T1;
  if (!t.fixed) {
    if (B0 > 2.2) T1 = t.T1at3T;
    else if (B0 >= 1) T1 = t.T1;
    else if (B0 >= 0.01) T1 = t.T1lo * (B0 / B_LO) ** (Math.log(t.T1 / t.T1lo) / Math.log(1.5 / B_LO));
    else T1 = t.T1earth ?? t.T1lo;
  }
  return { ...t, name, T1 };
}

// Shapes: {x, y, a, b, phi, tissue}: an ellipse centred on (x, y), semi-axis a along the
// direction phi (radians from the x axis), b across it, filled with the tissue; later shapes
// cover earlier ones.  A disk is an ellipse with a = b.
export const ellipse = (x, y, a, b, phiDeg, tissue) => ({ x, y, a, b, phi: (phiDeg * Math.PI) / 180, tissue });
export const disk = (x, y, R, tissue) => ellipse(x, y, R, R, 0, tissue);

// Ellipsoids: {x, y, z, a, b, c, phi, tissue}, an ellipse (x, y, a, b, phi) in every plane of
// constant z, shrinking as sqrt(1 - ((z - z0)/c)^2) away from its centre z0.  z runs along the
// body (and along B0), up through the top of the head.
export const ellipsoid = (x, y, z, a, b, c, phiDeg, tissue) => ({ x, y, z, a, b, c, phi: (phiDeg * Math.PI) / 180, tissue });

/** A head, in the spirit of the Shepp-Logan phantom, in three dimensions: scalp fat, skull,
 *  cerebrospinal fluid, cortex, white matter, two ventricles, a lesion, a pocket of fat, and
 *  the eyes, low in the front.  About 190 x 220 mm across and 236 mm tall. */
export function head3D() {
  return [
    ellipsoid(0, 0, 0, 95, 110, 118, 0, 'fat'),        // scalp
    ellipsoid(0, 0, 0, 88, 103, 111, 0, 'bone'),       // skull
    ellipsoid(0, 0, 0, 82, 97, 105, 0, 'water'),       // cerebrospinal fluid
    ellipsoid(0, -2, 0, 78, 92, 100, 0, 'grey'),       // cortex
    ellipsoid(0, -4, 0, 66, 80, 82, 0, 'white'),       // white matter
    ellipsoid(-22, 8, 6, 11, 32, 30, 15, 'water'),     // left ventricle
    ellipsoid(22, 8, 6, 11, 32, 30, -15, 'water'),     // right ventricle
    ellipsoid(38, -38, 0, 12, 9, 14, 20, 'lesion'),    // a lesion
    ellipsoid(-40, 52, 0, 7, 7, 7, 0, 'fat'),          // a pocket of fat
    ellipsoid(-30, 74, -38, 12, 12, 12, 0, 'water'),   // the eyes
    ellipsoid(30, 74, -38, 12, 12, 12, 0, 'water'),
  ];
}

/** The ellipses that ellipsoids make in the plane z (a slice seen from above). */
export function sliceOf(shapes3d, z) {
  const out = [];
  for (const e of shapes3d) {
    const u = (z - e.z) / e.c;
    if (Math.abs(u) >= 1) continue;
    const s = Math.sqrt(1 - u * u);
    out.push({ x: e.x, y: e.y, a: e.a * s, b: e.b * s, phi: e.phi, tissue: e.tissue });
  }
  return out;
}

/** The tissue at the point (x, y, z): the last ellipsoid that contains it, or null. */
export function tissueAt3D(shapes3d, x, y, z) {
  let t = null;
  for (const e of shapes3d) {
    const dx = x - e.x, dy = y - e.y, c = Math.cos(e.phi), sn = Math.sin(e.phi);
    const u = (dx * c + dy * sn) / e.a, w = (-dx * sn + dy * c) / e.b, v = (z - e.z) / e.c;
    if (u * u + w * w + v * v <= 1) t = e.tissue;
  }
  return t;
}

/** The head seen from above at the height z = 0: scalp fat, skull, CSF, cortex, white matter,
 *  two ventricles, a lesion, a pocket of fat.  About 190 x 220 mm. */
export function headPhantom(z = 0) { return sliceOf(head3D(), z); }

/** Three disks: water, fat and white matter (drag them). */
export function disksPhantom() {
  return [disk(-45, 22, 32, 'water'), disk(42, 36, 24, 'fat'), disk(8, -42, 36, 'white')];
}

/** Tubes standing along z in the board's coil (85 mm across inside), seen from above: tap
 *  water, water with copper sulphate, oil, and two thin tubes of tap water, 10 mm across and
 *  8 mm apart.  At low field the honest sample: a head would take hours, and its tissues' T1
 *  there is not known. */
export const TUBE_HEIGHT = 100;   // mm: with no slice, each pixel sees the whole height
export function tubesPhantom() {
  return [disk(-18, 18, 14, 'tap'), disk(18, 18, 14, 'cuso4'), disk(-18, -18, 14, 'oil'), disk(9, -18, 5, 'tap'), disk(27, -18, 5, 'tap')];
}

/** The extent of a list of shapes: [xmin, xmax, ymin, ymax] in mm ([0, 0, 0, 0] for none: a
 *  slice above the head holds no shapes, and must still make an (empty) picture). */
export function shapesExtent(shapes) {
  if (!shapes.length) return [0, 0, 0, 0];
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
    const y = (ny / 2 - j) * dx;
    for (let i = 0; i < nx; i++) {
      const x = (i - nx / 2) * dx, o = j * nx + i;
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
 * part of it that is fat or oil (for the chemical shift), from a rasterization and the
 * sequence; B0 picks the T1 values.  weights: the weight of each tissue, for readouts.
 */
export function weightedImage(raster, seq, B0 = 1.5) {
  const { nx, ny, fills } = raster, n = nx * ny;
  const total = new Float64Array(n), fat = new Float64Array(n), weights = {};
  for (const [name, f] of Object.entries(fills)) {
    const t = tissueAt(name, B0);
    if (!(t.rho > 0)) continue;
    const w = t.rho * weighting(t, seq);
    weights[name] = w;
    const into = t.shift ? fat : total;
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
        const y = (ny / 2 - j + ((q + 0.5) / ss - 0.5)) * dx;
        for (let p = 0; p < ss; p++) {
          const x = (i - nx / 2 + ((p + 0.5) / ss - 0.5)) * dx;
          // (Bin k is centred on s = (k - M/2) ds, as the tomography demo's detector is.)
          const k = Math.floor((x * c + y * sn) / ds + M / 2 + 0.5);
          if (k >= 0 && k < M) out[k] += v * w;
        }
      }
    }
  }
  return out;
}
