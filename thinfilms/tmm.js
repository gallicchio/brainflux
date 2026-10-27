// Reflection and transmission of a plane wave by a stack of layers: the characteristic-matrix
// (transfer-matrix) method, for s and p polarisation, at any angle, with complex indices.
//
// Conventions.  Fields go as exp(i(beta k0 x + q k0 z - w t)), k0 = 2 pi / lambda, the stack
// along z.  N = n + i kappa (kappa > 0 absorbs).  beta = n0 sin(theta0) is the same in every
// medium (Snell's law); in medium j the normal component is q_j = sqrt(N_j^2 - beta^2) = N_j cos
// theta_j, with Im q >= 0, so that a wave that cannot propagate (beyond the critical angle, or
// in a metal) decays in +z: the evanescent wave comes out by itself.
//
// In each medium the tangential fields are E (E_y for s, E_x for p) and H (-H_x/Y0 for s,
// H_y/Y0 for p, Y0 the admittance of free space), and a forward wave has H = eta E with the
// tilted admittance eta = q (s) or N^2 / q (p).  Both are continuous at every interface.  Across
// a layer of thickness d, with delta = k0 q d,
//
//     [E; H]front = M [E; H]back,   M = [[cos delta, -i sin delta / eta], [-i eta sin delta, cos delta]],
//
// so the stack's input admittance Y follows from the substrate's by Y <- C / B, where
// [B; C] = M [1; Y], working from the substrate towards the light (Macleod, Thin-Film Optical
// Filters, ch. 2, with the sign of i for exp(-iwt)).  Then
//
//     r = (eta0 - Y) / (eta0 + Y),   R = |r|^2,   T = Re(eta_s) |E_s|^2 / eta0,
//
// with E_s the tangential field in the substrate for an incident tangential field of 1.  The
// sines and cosines of complex delta grow as exp(|Im delta|); they are carried scaled by
// exp(-|Im delta|), so thick metal films and wide tunnelling gaps neither overflow nor lose
// accuracy.
//
// The quantum-mechanical analogue: for s polarisation E_y obeys E'' + k0^2 (N^2 - beta^2) E = 0
// with E and E' continuous, the time-independent Schrödinger equation with k^2 = 2m(E - V)/hbar^2
// replaced by k0^2 (N^2 - beta^2).  Total internal reflection is a classically forbidden
// region, and frustrated TIR is tunnelling.

// The hot loops write their complex intermediate results into these instead of returning new
// arrays (which the garbage collector would then have to sweep up, thousands per frame).
const Q = new Float64Array(2);

// q = sqrt(N^2 - beta^2) into Q, with Im q >= 0 (and q > 0 when real).  For a passive medium
// (Im N^2 >= 0) the principal root already has Im q >= 0, so the wave decays in +z; with gain
// (Im N^2 < 0) the root with Re q > 0, which carries energy forward, is kept.
function qInto(nr, ni, beta) {
  const ar = nr * nr - ni * ni - beta * beta, ai = 2 * nr * ni;
  const m = Math.hypot(ar, ai);
  const qr = Math.sqrt(Math.max(0, (m + ar) / 2));
  let qi = Math.sqrt(Math.max(0, (m - ar) / 2));
  if (ai < 0) qi = -qi;
  // q = 0 exactly (grazing, or exactly at a critical angle) makes eta_p infinite: nudge it.
  Q[0] = qr; Q[1] = qr * qr + qi * qi < 1e-24 ? 1e-12 : qi;
}

/** Normal component q = sqrt(N^2 - beta^2) with Im q >= 0 (and q > 0 when real), as [re, im]. */
export function normalComponent(nr, ni, beta) { qInto(nr, ni, beta); return [Q[0], Q[1]]; }

/** Tilted admittance eta for polarisation pol ('s' or 'p'), as [re, im]. */
export function admittance(nr, ni, qr, qi, pol) {
  if (pol === 's') return [qr, qi];
  // N^2 / q
  const er = nr * nr - ni * ni, ei = 2 * nr * ni, d = qr * qr + qi * qi;
  return [(er * qr + ei * qi) / d, (ei * qr - er * qi) / d];
}

// cos and sin of a + ib, both times exp(-|b|), into out[0..3] = [cos re, cos im, sin re, sin im].
function scaledCosSin(a, b, out) {
  const e = Math.exp(-2 * Math.abs(b));
  const ch = (1 + e) / 2, sh = (b >= 0 ? 1 : -1) * (1 - e) / 2;   // cosh b, sinh b times e^-|b|
  const c = Math.cos(a), s = Math.sin(a);
  out[0] = c * ch; out[1] = -s * sh;          // cos(a + ib) = cos a cosh b - i sin a sinh b
  out[2] = s * ch; out[3] = c * sh;           // sin(a + ib) = sin a cosh b + i cos a sinh b
}

/**
 * The stack at one wavelength, ready to solve:
 *   n0      incident medium's index (real: the light arrives through a transparent medium)
 *   layers  Float64Arrays nr, ni, d (nm), one entry per layer, from the light's side
 *   ns      substrate index [nr, ni]
 * Returns a workspace that solve() fills.
 */
export function makeWorkspace(maxLayers) {
  return {
    Yr: new Float64Array(maxLayers + 1), Yi: new Float64Array(maxLayers + 1),   // admittance at the back of layer j
    Br: new Float64Array(maxLayers), Bi: new Float64Array(maxLayers), sc: new Float64Array(maxLayers),
    er: new Float64Array(maxLayers), ei: new Float64Array(maxLayers),           // eta of each layer
    qr: new Float64Array(maxLayers), qi: new Float64Array(maxLayers),
  };
}

const cs = new Float64Array(4);

/**
 * Solve one stack for one wavelength, beta and polarisation.
 *   lambda   vacuum wavelength, nm (same unit as the thicknesses)
 *   beta     n0 sin(theta0)
 * Returns { rr, ri, R, T, A, tr, ti } (r and the substrate's tangential E, E_s = t) and, if ws
 * is given, leaves in it what field() needs.
 */
export function solve(n0, nr, ni, d, ns, lambda, beta, pol, ws = null) {
  const L = nr.length, k0 = (2 * Math.PI) / lambda;
  const [q0r] = normalComponent(n0, 0, beta);
  const eta0 = pol === 's' ? q0r : (n0 * n0) / q0r;
  const [qsr, qsi] = normalComponent(ns[0], ns[1], beta);
  const [esr, esi] = admittance(ns[0], ns[1], qsr, qsi, pol);
  let Yr = esr, Yi = esi;
  // Product of the scaled B's and the sum of the scale exponents: E_front / E_back = B.
  let Pr = 1, Pi = 0, scale = 0;
  if (ws) { ws.Yr[L] = Yr; ws.Yi[L] = Yi; }
  for (let j = L - 1; j >= 0; j--) {
    const [qr, qi] = normalComponent(nr[j], ni[j], beta);
    const [hr, hi] = admittance(nr[j], ni[j], qr, qi, pol);
    const a = k0 * qr * d[j], b = k0 * qi * d[j];
    scaledCosSin(a, b, cs);
    // Y / eta
    const hh = hr * hr + hi * hi;
    const yr = (Yr * hr + Yi * hi) / hh, yi = (Yi * hr - Yr * hi) / hh;
    // B = cos - i (Y/eta) sin ;  C = -i eta sin + Y cos
    const isr = -cs[3], isi = cs[2];      // i sin = i(sr + i si) = -si + i sr
    const Br = cs[0] - (yr * isr - yi * isi), Bi = cs[1] - (yr * isi + yi * isr);
    const Cr = -(hr * isr - hi * isi) + (Yr * cs[0] - Yi * cs[1]);
    const Ci = -(hr * isi + hi * isr) + (Yr * cs[1] + Yi * cs[0]);
    const bb = Br * Br + Bi * Bi;
    Yr = (Cr * Br + Ci * Bi) / bb; Yi = (Ci * Br - Cr * Bi) / bb;
    const pr = Pr * Br - Pi * Bi; Pi = Pr * Bi + Pi * Br; Pr = pr;
    scale += Math.abs(b);
    if (ws) {
      ws.Yr[j] = Yr; ws.Yi[j] = Yi; ws.Br[j] = Br; ws.Bi[j] = Bi; ws.sc[j] = Math.abs(b);
      ws.er[j] = hr; ws.ei[j] = hi; ws.qr[j] = qr; ws.qi[j] = qi;
    }
  }
  // r = (eta0 - Y) / (eta0 + Y)
  const nr_ = eta0 - Yr, ni_ = -Yi, dr = eta0 + Yr, di = Yi, dd = dr * dr + di * di;
  const rr = (nr_ * dr + ni_ * di) / dd, ri = (ni_ * dr - nr_ * di) / dd;
  // E_s = (1 + r) / (P e^scale)
  const pp = Pr * Pr + Pi * Pi, f = Math.exp(-scale);
  const tr = (((1 + rr) * Pr + ri * Pi) / pp) * f, ti = ((ri * Pr - (1 + rr) * Pi) / pp) * f;
  const R = rr * rr + ri * ri;
  // A substrate the wave cannot enter (q purely imaginary, lossless) carries no energy.
  const T = (esr * (tr * tr + ti * ti)) / eta0;
  if (ws) Object.assign(ws, { L, k0, n0, beta, pol, eta0, q0: q0r, rr, ri, tr, ti, qs: [qsr, qsi], etas: [esr, esi], ns, nr, ni, d });
  return { rr, ri, R, T, A: 1 - R - T, tr, ti };
}

/**
 * The field at positions zs (nm; z = 0 is the front of the first layer, z < 0 the incident
 * medium), from a workspace that solve() has just filled.  For each z: the tangential E and H
 * (complex) and |E|^2 of the whole vector (for p, E_z = -(beta / N^2) H as well), with the
 * incident wave's tangential E equal to 1.  Within a layer, the forward wave is built from the
 * front face and the backward wave from the back face, so each only ever decays as it is
 * carried: stable in thick evanescent or metal layers.
 * Returns { Er, Ei, Hr, Hi, E2 } (Float64Arrays) and the layer index of each point (-1 incident,
 * L substrate) in .where.
 */
export function field(ws, zs) {
  const { L, k0, n0, beta, pol, eta0, q0, rr, ri, nr, ni, d } = ws;
  const m = zs.length;
  const out = { Er: new Float64Array(m), Ei: new Float64Array(m), Hr: new Float64Array(m), Hi: new Float64Array(m),
    E2: new Float64Array(m), where: new Int16Array(m) };
  // Tangential fields at the front of each layer and at the back of the last.
  const Efr = new Float64Array(L + 1), Efi = new Float64Array(L + 1), Hfr = new Float64Array(L + 1), Hfi = new Float64Array(L + 1);
  Efr[0] = 1 + rr; Efi[0] = ri; Hfr[0] = eta0 * (1 - rr); Hfi[0] = -eta0 * ri;
  for (let j = 0; j < L; j++) {
    // E_back = E_front / (B e^sc);  H_back = Y_back E_back
    const Br = ws.Br[j], Bi = ws.Bi[j], bb = Br * Br + Bi * Bi, f = Math.exp(-ws.sc[j]);
    const er = ((Efr[j] * Br + Efi[j] * Bi) / bb) * f, ei = ((Efi[j] * Br - Efr[j] * Bi) / bb) * f;
    Efr[j + 1] = er; Efi[j + 1] = ei;
    Hfr[j + 1] = ws.Yr[j + 1] * er - ws.Yi[j + 1] * ei; Hfi[j + 1] = ws.Yr[j + 1] * ei + ws.Yi[j + 1] * er;
  }
  const starts = new Float64Array(L + 1);
  for (let j = 0; j < L; j++) starts[j + 1] = starts[j] + d[j];
  // E_z factor for p: -beta / N^2 per medium.
  const ezFactor = (Nr, Ni) => { const er = Nr * Nr - Ni * Ni, ei = 2 * Nr * Ni, q = er * er + ei * ei; return [(-beta * er) / q, (beta * ei) / q]; };
  for (let o = 0; o < m; o++) {
    const z = zs[o];
    let Er, Ei, Hr, Hi, j, Nr, Ni;
    if (z < 0) {
      // e^{i k0 q0 z} + r e^{-i k0 q0 z}
      j = -1; Nr = n0; Ni = 0;
      const ph = k0 * q0 * z, c = Math.cos(ph), s = Math.sin(ph);
      const br = rr * c + ri * s, bi = ri * c - rr * s;    // r e^{-i ph}
      Er = c + br; Ei = s + bi; Hr = eta0 * (c - br); Hi = eta0 * (s - bi);
    } else {
      j = 0;
      while (j < L && z > starts[j + 1]) j++;
      if (j === L) {
        // The substrate: E_s e^{i k0 q_s (z - z_end)}
        Nr = ws.ns[0]; Ni = ws.ns[1];
        const u = z - starts[L], [qr, qi] = ws.qs, amp = Math.exp(-k0 * qi * u), ph = k0 * qr * u;
        const c = amp * Math.cos(ph), s = amp * Math.sin(ph);
        Er = Efr[L] * c - Efi[L] * s; Ei = Efr[L] * s + Efi[L] * c;
        const [hr, hi] = ws.etas;
        Hr = hr * Er - hi * Ei; Hi = hr * Ei + hi * Er;
      } else {
        Nr = nr[j]; Ni = ni[j];
        const u = z - starts[j], hr = ws.er[j], hi = ws.ei[j], hh = hr * hr + hi * hi;
        // a = (E_f + H_f / eta) / 2 at the front;  b = (E_b - H_b / eta) / 2 at the back.
        const hfr = (Hfr[j] * hr + Hfi[j] * hi) / hh, hfi = (Hfi[j] * hr - Hfr[j] * hi) / hh;
        const hbr = (Hfr[j + 1] * hr + Hfi[j + 1] * hi) / hh, hbi = (Hfi[j + 1] * hr - Hfr[j + 1] * hi) / hh;
        const ar = (Efr[j] + hfr) / 2, ai = (Efi[j] + hfi) / 2;
        const bR = (Efr[j + 1] - hbr) / 2, bI = (Efi[j + 1] - hbi) / 2;
        const qr = ws.qr[j], qi = ws.qi[j];
        // e^{i k0 q u} and e^{i k0 q (d - u)}
        const a1 = Math.exp(-k0 * qi * u), p1 = k0 * qr * u;
        const a2 = Math.exp(-k0 * qi * (d[j] - u)), p2 = k0 * qr * (d[j] - u);
        const fr = a1 * Math.cos(p1), fi = a1 * Math.sin(p1), gr = a2 * Math.cos(p2), gi = a2 * Math.sin(p2);
        const Fr = ar * fr - ai * fi, Fi = ar * fi + ai * fr, Gr = bR * gr - bI * gi, Gi = bR * gi + bI * gr;
        Er = Fr + Gr; Ei = Fi + Gi;
        const Dr = Fr - Gr, Di = Fi - Gi;
        Hr = hr * Dr - hi * Di; Hi = hr * Di + hi * Dr;
      }
    }
    out.Er[o] = Er; out.Ei[o] = Ei; out.Hr[o] = Hr; out.Hi[o] = Hi; out.where[o] = j < 0 ? -1 : j;
    let E2 = Er * Er + Ei * Ei;
    if (pol === 'p') {
      const [fr, fi] = ezFactor(Nr, Ni);
      const zr = fr * Hr - fi * Hi, zi = fr * Hi + fi * Hr;
      E2 += zr * zr + zi * zi;
    }
    out.E2[o] = E2;
  }
  return out;
}

/** |E_incident|^2 for an incident tangential field of 1: 1 for s, 1 / cos^2(theta0) for p. */
export function incidentE2(ws) {
  return ws.pol === 's' ? 1 : (ws.n0 * ws.n0) / (ws.q0 * ws.q0);
}

/**
 * The fraction of the incident power absorbed in each layer (and the substrate, to depth
 * zmax past the stack if it absorbs), by integrating the absorption density
 * k0 Im(N^2) |E|^2 / eta0 over z with Simpson's rule, independently of R and T.
 */
export function absorbedByLayer(ws, pointsPerLayer = 400) {
  const out = [];
  let z0 = 0;
  for (let j = 0; j < ws.L; j++) {
    const dj = ws.d[j], im = 2 * ws.nr[j] * ws.ni[j], n = pointsPerLayer % 2 ? pointsPerLayer + 1 : pointsPerLayer;
    if (dj <= 0 || im === 0) { out.push(0); z0 += dj; continue; }
    // Sample strictly inside the layer (the field function assigns a boundary to the left).
    const zs = Float64Array.from({ length: n + 1 }, (_, i) => z0 + Math.min(dj * (1 - 1e-12), Math.max(dj * 1e-12, (dj * i) / n)));
    const { E2 } = field(ws, zs);
    let s = E2[0] + E2[n];
    for (let i = 1; i < n; i++) s += (i % 2 ? 4 : 2) * E2[i];
    out.push((ws.k0 * im * (s * dj) / (3 * n)) / ws.eta0);
    z0 += dj;
  }
  return out;
}

// The scaled characteristic matrix of a layer with normal component q, admittance eta and
// thickness d into m[0..7] (re, im of m00, m01, m10, m11); returns the scale exponent |Im delta|
// (the true matrix is m e^scale).
function layerMatrixQ(qr, qi, hr, hi, d, k0, m) {
  const b = k0 * qi * d;
  scaledCosSin(k0 * qr * d, b, cs);
  const isr = -cs[3], isi = cs[2], hh = hr * hr + hi * hi;
  m[0] = cs[0]; m[1] = cs[1]; m[6] = cs[0]; m[7] = cs[1];
  // -i sin / eta
  m[2] = -(isr * hr + isi * hi) / hh; m[3] = -(isi * hr - isr * hi) / hh;
  // -i eta sin
  m[4] = -(hr * isr - hi * isi); m[5] = -(hr * isi + hi * isr);
  return Math.abs(b);
}
function layerMatrix(nr, ni, d, k0, beta, pol, m) {
  qInto(nr, ni, beta);
  const [hr, hi] = admittance(nr, ni, Q[0], Q[1], pol);
  return layerMatrixQ(Q[0], Q[1], hr, hi, d, k0, m);
}

// a <- a b for 2 x 2 complex matrices stored as above.
function matMul(a, b) {
  const r = new Float64Array(8);
  for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) {
    const x = 4 * i, y = 2 * j;
    const ar0 = a[x], ai0 = a[x + 1], ar1 = a[x + 2], ai1 = a[x + 3];
    const br0 = b[y], bi0 = b[y + 1], br1 = b[4 + y], bi1 = b[4 + y + 1];
    r[x + y] = ar0 * br0 - ai0 * bi0 + ar1 * br1 - ai1 * bi1;
    r[x + y + 1] = ar0 * bi0 + ai0 * br0 + ar1 * bi1 + ai1 * br1;
  }
  a.set(r);
}

/**
 * R and T as one layer's thickness runs through `thicknesses` (nm), the rest of the stack
 * fixed: the layers before it are one matrix, those after it one vector, so each thickness
 * costs a single layer.  Writes outR[i], outT[i] (T as in solve()).
 */
export function sweepLayer(n0, nr, ni, d, ns, lambda, beta, pol, jSel, thicknesses, outR, outT) {
  const L = nr.length, k0 = (2 * Math.PI) / lambda;
  const [q0r] = normalComponent(n0, 0, beta);
  const eta0 = pol === 's' ? q0r : (n0 * n0) / q0r;
  const [qsr, qsi] = normalComponent(ns[0], ns[1], beta);
  const [esr, esi] = admittance(ns[0], ns[1], qsr, qsi, pol);
  const m = new Float64Array(8);
  // The layers in front of the selected one: Mpre = M0 M1 ... M(jSel-1).
  const pre = new Float64Array([1, 0, 0, 0, 0, 0, 1, 0]);
  let sPre = 0;
  for (let j = 0; j < jSel; j++) { sPre += layerMatrix(nr[j], ni[j], d[j], k0, beta, pol, m); matMul(pre, m); }
  // Those behind it: v = M(jSel+1) ... M(L-1) [1; eta_s], applied from the substrate up.
  let vBr = 1, vBi = 0, vCr = esr, vCi = esi, sPost = 0;
  for (let j = L - 1; j > jSel; j--) {
    sPost += layerMatrix(nr[j], ni[j], d[j], k0, beta, pol, m);
    const Br = m[0] * vBr - m[1] * vBi + m[2] * vCr - m[3] * vCi, Bi = m[0] * vBi + m[1] * vBr + m[2] * vCi + m[3] * vCr;
    const Cr = m[4] * vBr - m[5] * vBi + m[6] * vCr - m[7] * vCi, Ci = m[4] * vBi + m[5] * vBr + m[6] * vCi + m[7] * vCr;
    vBr = Br; vBi = Bi; vCr = Cr; vCi = Ci;
  }
  // The swept layer's q and eta do not depend on its thickness.
  qInto(nr[jSel], ni[jSel], beta);
  const qr = Q[0], qi = Q[1], [hr, hi] = admittance(nr[jSel], ni[jSel], qr, qi, pol);
  for (let t = 0; t < thicknesses.length; t++) {
    const s = layerMatrixQ(qr, qi, hr, hi, thicknesses[t], k0, m);
    const Br = m[0] * vBr - m[1] * vBi + m[2] * vCr - m[3] * vCi, Bi = m[0] * vBi + m[1] * vBr + m[2] * vCi + m[3] * vCr;
    const Cr = m[4] * vBr - m[5] * vBi + m[6] * vCr - m[7] * vCi, Ci = m[4] * vBi + m[5] * vBr + m[6] * vCi + m[7] * vCr;
    const B2r = pre[0] * Br - pre[1] * Bi + pre[2] * Cr - pre[3] * Ci, B2i = pre[0] * Bi + pre[1] * Br + pre[2] * Ci + pre[3] * Cr;
    const C2r = pre[4] * Br - pre[5] * Bi + pre[6] * Cr - pre[7] * Ci, C2i = pre[4] * Bi + pre[5] * Br + pre[6] * Ci + pre[7] * Cr;
    // r = (eta0 B - C) / (eta0 B + C)
    const nRe = eta0 * B2r - C2r, nIm = eta0 * B2i - C2i, dRe = eta0 * B2r + C2r, dIm = eta0 * B2i + C2i;
    const dd = dRe * dRe + dIm * dIm;
    outR[t] = (nRe * nRe + nIm * nIm) / dd;
    if (outT) outT[t] = ((4 * eta0 * esr) / dd) * Math.exp(-2 * (sPre + s + sPost));
  }
}

// One layer's effect on (Y, P) stored at st[o..o+3] = Yr, Yi, Pr, Pi, for a layer of admittance
// (hr, hi) whose scaled cos and sin are in cs: Y <- C / B, P <- P B, [B; C] = M [1; Y].
function stepY(st, o, hr, hi) {
  const Yr = st[o], Yi = st[o + 1], hh = hr * hr + hi * hi;
  const yr = (Yr * hr + Yi * hi) / hh, yi = (Yi * hr - Yr * hi) / hh;
  const isr = -cs[3], isi = cs[2];
  const Br = cs[0] - (yr * isr - yi * isi), Bi = cs[1] - (yr * isi + yi * isr);
  const Cr = -(hr * isr - hi * isi) + (Yr * cs[0] - Yi * cs[1]);
  const Ci = -(hr * isi + hi * isr) + (Yr * cs[1] + Yi * cs[0]);
  const bb = Br * Br + Bi * Bi;
  st[o] = (Cr * Br + Ci * Bi) / bb; st[o + 1] = (Ci * Br - Cr * Bi) / bb;
  const Pr = st[o + 2], Pi = st[o + 3];
  st[o + 2] = Pr * Br - Pi * Bi; st[o + 3] = Pr * Bi + Pi * Br;
}
// r and T from (Y, P) at st[o..]: writes R, T into out[k], out[k + 1].
function finish(st, o, eta0, esr, scale, out, k) {
  const Yr = st[o], Yi = st[o + 1];
  const nr = eta0 - Yr, ni = -Yi, dr = eta0 + Yr, di = Yi, dd = dr * dr + di * di;
  const rr = (nr * dr + ni * di) / dd, ri = (ni * dr - nr * di) / dd;
  const Pr = st[o + 2], Pi = st[o + 3], pp = Pr * Pr + Pi * Pi, f = Math.exp(-scale);
  const tr = (((1 + rr) * Pr + ri * Pi) / pp) * f, ti = ((ri * Pr - (1 + rr) * Pi) / pp) * f;
  out[k] = rr * rr + ri * ri; out[k + 1] = (esr * (tr * tr + ti * ti)) / eta0;
}
const ST = new Float64Array(8);

/**
 * R and T for s and p at once, the fast path for curves: the two polarisations share each
 * layer's normal component and its sines and cosines.  Writes out[0..3] = Rs, Ts, Rp, Tp, the
 * same numbers solve() gives.
 */
export function rtBoth(n0, nr, ni, d, ns, lambda, beta, out) {
  const L = nr.length, k0 = (2 * Math.PI) / lambda;
  const q0 = Math.sqrt(Math.max(n0 * n0 - beta * beta, 1e-24)), e0s = q0, e0p = (n0 * n0) / q0;
  qInto(ns[0], ns[1], beta);
  const qsr = Q[0], qsi = Q[1];
  let er = ns[0] * ns[0] - ns[1] * ns[1], ei = 2 * ns[0] * ns[1], dq = qsr * qsr + qsi * qsi;
  const epr = (er * qsr + ei * qsi) / dq, epi = (ei * qsr - er * qsi) / dq;
  ST[0] = qsr; ST[1] = qsi; ST[2] = 1; ST[3] = 0; ST[4] = epr; ST[5] = epi; ST[6] = 1; ST[7] = 0;
  let scale = 0;
  for (let j = L - 1; j >= 0; j--) {
    qInto(nr[j], ni[j], beta);
    const qr = Q[0], qi = Q[1], b = k0 * qi * d[j];
    scaledCosSin(k0 * qr * d[j], b, cs);
    stepY(ST, 0, qr, qi);
    er = nr[j] * nr[j] - ni[j] * ni[j]; ei = 2 * nr[j] * ni[j]; dq = qr * qr + qi * qi;
    stepY(ST, 4, (er * qr + ei * qi) / dq, (ei * qr - er * qi) / dq);
    scale += Math.abs(b);
  }
  finish(ST, 0, e0s, qsr, scale, out, 0);
  finish(ST, 4, e0p, epr, scale, out, 2);
  return out;
}

/**
 * The phase of r_s minus the phase of r_p, in degrees in (-180, 180], with the p axes of Born &
 * Wolf (right-handed with each beam's direction, so r_p = -r_s at normal incidence).  solve()
 * gives r_p for the tangential field, which is minus that.
 */
export function phaseDifference(s, p) {
  const d = Math.atan2(s.ri, s.rr) - Math.atan2(-p.ri, -p.rr);
  return (((d + 3 * Math.PI) % (2 * Math.PI)) - Math.PI) * (180 / Math.PI);
}

/** Shorthand for tests and readouts: R, T, A and r for a stack given as plain arrays. */
export function rt(n0, layers, ns, lambda, thetaDeg, pol) {
  const nr = Float64Array.from(layers, (l) => l[0]), ni = Float64Array.from(layers, (l) => l[1]), d = Float64Array.from(layers, (l) => l[2]);
  const beta = n0 * Math.sin((thetaDeg * Math.PI) / 180);
  return solve(n0, nr, ni, d, ns, lambda, beta, pol);
}
