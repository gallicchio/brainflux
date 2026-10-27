// Optical constants: the complex refractive index N = n + i kappa as a function of the vacuum
// wavelength, from published closed-form fits.  The convention is the physicist's,
// E ~ exp(i(kz - wt)), so an absorbing medium has kappa > 0.  Indices are absolute (relative to
// vacuum); handbooks often quote them relative to air, which is 1.0003 times smaller.
//
// Each material: { name, short, kind: 'dielectric' | 'metal', index(lambdaNm) -> [n, kappa],
// range: [nm, nm] where the fit is valid, ref: the source }.

// Sellmeier's formula, n^2 = 1 + sum B lambda^2 / (lambda^2 - C), lambda in micrometres.
function sellmeier(B, C) {
  return (nm) => {
    const l2 = (nm / 1000) ** 2;
    let e = 1;
    for (let j = 0; j < B.length; j++) e += (B[j] * l2) / (l2 - C[j]);
    return [Math.sqrt(e), 0];
  };
}

// The Lorentz-Drude model of Rakic, Djurisic, Elazar and Majewski: a free-electron (Drude)
// term plus Lorentz oscillators for the interband transitions, energies in eV:
//   eps(w) = 1 - f0 wp^2 / (w (w + i G0)) + sum_j fj wp^2 / (wj^2 - w^2 - i w Gj).
// (Written for exp(-iwt): Im eps > 0 is loss.)  The fit is to measured data over 0.1-5 eV and
// is good to several per cent in |eps| in the visible, less near the interband edges.
function lorentzDrude(wp, f, G, w) {
  return (nm) => {
    const W = 1239.84193 / nm;            // photon energy, eV
    // Drude: -f0 wp^2 / (W^2 + i W G0)
    let a = W * W, b = W * G[0], q = a * a + b * b;
    let er = 1 - (f[0] * wp * wp * a) / q, ei = (f[0] * wp * wp * b) / q;
    for (let j = 1; j < f.length; j++) {
      a = w[j] * w[j] - W * W; b = -W * G[j]; q = a * a + b * b;
      er += (f[j] * wp * wp * a) / q; ei -= (f[j] * wp * wp * b) / q;
    }
    return sqrtEps(er, ei);
  };
}

/** N = sqrt(eps) with Im N >= 0 (the root of a passive medium). */
export function sqrtEps(er, ei) {
  const m = Math.hypot(er, ei);
  let n = Math.sqrt(Math.max(0, (m + er) / 2)), k = Math.sqrt(Math.max(0, (m - er) / 2));
  if (ei < 0) k = -k;           // gain: then n > 0 and kappa < 0
  return [n, k];
}

export const MATERIALS = {
  air: {
    name: 'Air', short: 'air', kind: 'dielectric', index: () => [1, 0], range: [200, 2000],
    ref: 'Real air is 1.0003; the difference does not show here',
  },
  water: {
    name: 'Water', short: 'water', kind: 'dielectric', range: [182, 1129],
    // M. Daimon and A. Masumura, "Measurement of the refractive index of distilled water from
    // the near-infrared region to the ultraviolet region," Appl. Opt. 46, 3811-3820 (2007),
    // four-term Sellmeier fit at 20 C.  (It agrees with the IAPWS 1997 formulation, Harvey et
    // al., J. Phys. Chem. Ref. Data 27, 761 (1998), to 1e-5 in the visible.)
    index: sellmeier([5.684027565e-1, 1.726177391e-1, 2.086189578e-2, 1.130748688e-1],
      [5.101829712e-3, 1.821153936e-2, 2.620722293e-2, 1.069792721e1]),
    ref: 'Daimon & Masumura, Appl. Opt. 46, 3811 (2007), 20 °C',
  },
  silica: {
    name: 'Fused silica (SiO₂)', short: 'SiO₂', kind: 'dielectric', range: [210, 3710],
    // I. H. Malitson, "Interspecimen comparison of the refractive index of fused silica,"
    // J. Opt. Soc. Am. 55, 1205-1209 (1965).
    index: sellmeier([0.6961663, 0.4079426, 0.8974794], [0.0684043 ** 2, 0.1162414 ** 2, 9.896161 ** 2]),
    ref: 'Malitson, J. Opt. Soc. Am. 55, 1205 (1965)',
  },
  bk7: {
    name: 'BK7 glass', short: 'BK7', kind: 'dielectric', range: [300, 2500],
    // Schott N-BK7 data sheet (Schott optical glass catalogue), Sellmeier coefficients.
    index: sellmeier([1.03961212, 0.231792344, 1.01046945], [0.00600069867, 0.0200179144, 103.560653]),
    ref: 'Schott N-BK7 catalogue Sellmeier fit',
  },
  mgf2: {
    name: 'MgF₂', short: 'MgF₂', kind: 'dielectric', range: [200, 7000],
    // M. J. Dodge, "Refractive properties of magnesium fluoride," Appl. Opt. 23, 1980-1985
    // (1984), ordinary ray.  (Evaporated MgF2 coatings are nearly isotropic, n = 1.38.)
    index: sellmeier([0.48755108, 0.39875031, 2.3120353], [0.04338408 ** 2, 0.09461442 ** 2, 23.793604 ** 2]),
    ref: 'Dodge, Appl. Opt. 23, 1980 (1984), ordinary ray',
  },
  tio2: {
    name: 'TiO₂ (rutile)', short: 'TiO₂', kind: 'dielectric', range: [430, 1530],
    // J. R. DeVore, "Refractive indices of rutile and sphalerite," J. Opt. Soc. Am. 41,
    // 416-419 (1951), ordinary ray: n^2 = 5.913 + 0.2441 / (lambda^2 - 0.0803), lambda in um.
    // Rutile absorbs below about 420 nm, which this formula ignores; evaporated TiO2 films
    // have lower indices, 2.2 to 2.4.
    index: (nm) => { const l2 = (nm / 1000) ** 2; return [Math.sqrt(5.913 + 0.2441 / Math.max(l2 - 0.0803, 0.02)), 0]; },
    ref: 'DeVore, J. Opt. Soc. Am. 41, 416 (1951), rutile ordinary ray',
  },
  oil: {
    name: 'Oil (n = 1.47)', short: 'oil', kind: 'dielectric', index: () => [1.47, 0], range: [200, 2000],
    ref: 'A typical vegetable or mineral oil, its dispersion ignored',
  },
  silver: {
    name: 'Silver', short: 'Ag', kind: 'metal', range: [250, 2000],
    // A. D. Rakic, A. B. Djurisic, J. M. Elazar and M. L. Majewski, "Optical properties of
    // metallic films for vertical-cavity optoelectronic devices," Appl. Opt. 37, 5271-5283
    // (1998), Table 1 (Lorentz-Drude model).
    index: lorentzDrude(9.01, [0.845, 0.065, 0.124, 0.011, 0.840, 5.646],
      [0.048, 3.886, 0.452, 0.065, 0.916, 2.419], [0, 0.816, 4.481, 8.185, 9.083, 20.29]),
    ref: 'Rakić et al., Appl. Opt. 37, 5271 (1998), Lorentz–Drude fit',
  },
  gold: {
    name: 'Gold', short: 'Au', kind: 'metal', range: [250, 2000],
    // Rakic et al. (1998), as above.
    index: lorentzDrude(9.03, [0.760, 0.024, 0.010, 0.071, 0.601, 4.384],
      [0.053, 0.241, 0.345, 0.870, 2.494, 2.214], [0, 0.415, 0.830, 2.969, 4.304, 13.32]),
    ref: 'Rakić et al., Appl. Opt. 37, 5271 (1998), Lorentz–Drude fit',
  },
  aluminium: {
    name: 'Aluminium', short: 'Al', kind: 'metal', range: [200, 2000],
    // Rakic et al. (1998), as above.
    index: lorentzDrude(14.98, [0.523, 0.227, 0.050, 0.166, 0.030],
      [0.047, 0.333, 0.312, 1.351, 3.382], [0, 0.162, 1.544, 1.808, 3.473]),
    ref: 'Rakić et al., Appl. Opt. 37, 5271 (1998), Lorentz–Drude fit',
  },
};

/** Material ids in the order the menus list them. */
export const MATERIAL_ORDER = ['air', 'water', 'oil', 'mgf2', 'silica', 'bk7', 'tio2', 'silver', 'gold', 'aluminium'];

/**
 * A typed index n(lambda) from a parsed expression (lib/expr.js) in the variable 'lambda'
 * (micrometres): returns index(nm) -> [n, kappa].  Evaluated for arrays of wavelengths at once
 * by indexArray, which is what the plots use.
 */
export function typedMaterial(expr, params) {
  const one = (nm) => {
    const v = expr.value({ lambda: nm / 1000, ...params });
    return [Number.isFinite(v.re) ? v.re : NaN, Number.isFinite(v.im) ? v.im : 0];
  };
  return {
    name: 'Typed n(λ)', short: 'n(λ)', kind: 'typed', range: [200, 2000], ref: 'typed',
    index: one,
    indexArray(nms) {
      const lam = Float64Array.from(nms, (x) => x / 1000);
      const v = expr.evaluate({ lambda: lam, ...params }, lam.length);
      return [v.re, v.im || new Float64Array(lam.length)];
    },
  };
}

/** Indices of a material at many wavelengths: [n[], kappa[]] (Float64Arrays). */
export function indexArray(mat, nms) {
  if (mat.indexArray) return mat.indexArray(nms);
  const n = new Float64Array(nms.length), k = new Float64Array(nms.length);
  for (let i = 0; i < nms.length; i++) { const v = mat.index(nms[i]); n[i] = v[0]; k[i] = v[1]; }
  return [n, k];
}
