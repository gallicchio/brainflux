// What is painted on the grid: materials, shapes and brush strokes, in vacuum wavelengths, with
// the origin in the middle of the box and y upwards.
//
// Every shape is drawn onto a fine grid of SUB x SUB samples per cell (later shapes on top), and
// each field location gets the average of the samples around it: an interface that cuts a cell
// gives it an in-between permittivity, so curved and tilted surfaces are not staircases and a
// slab can be any thickness.  An electric field parallel to the interfaces in its cell sees the
// arithmetic mean of eps, one normal to them the harmonic mean; Ez (TM) is always parallel, and
// for Ex and Ey (TE) the mean is taken along the field's direction harmonically and across it
// arithmetically.  Materials that touch the edge of the box carry on into the absorbing layer, so
// a slab or a waveguide runs out of the box instead of ending at a mirror.

export const SUB = 4;
export const SIGMA_ABSORBER = 6;     // the absorber's loss: amplitude falls by e^-6 per wavelength

/** The materials of the brush: n, or a perfect conductor, or the absorber. */
export const MATERIALS = {
  glass: { label: 'Glass', n: 1.5, title: 'n = 1.5' },
  high: { label: 'High index', n: 3.5, title: 'n = 3.5, like silicon in the infrared' },
  typed: { label: 'n =', n: 2, title: 'Any index you choose' },
  metal: { label: 'Metal', pec: true, title: 'A perfect conductor: the tangential electric field is zero on it' },
  absorber: { label: 'Absorber', absorb: true, title: 'A lossy material matched to vacuum: it absorbs without reflecting' },
  eraser: { label: 'Eraser', bg: true, title: 'Back to the background (vacuum, or the typed n(x, y))' },
};

const keyOf = (m) => (m.bg ? 'bg' : m.pec ? 'pec' : m.absorb ? 'abs' : `n${m.n}`);
/** The shapes' outlines alone, without their indices: what decides which fine cells they cover. */
const shapeOutlines = (ops) => JSON.stringify(ops, (k, v) => (k === 'mat' ? { pec: !!v.pec, absorb: !!v.absorb, bg: !!v.bg } : v));

// --------------------------------------------------------------------------- shapes

const inPoly = (pts, x, y) => {
  let inside = false;
  for (let a = 0, b = pts.length - 1; a < pts.length; b = a++) {
    const [xa, ya] = pts[a], [xb, yb] = pts[b];
    if ((ya > y) !== (yb > y) && x < ((xb - xa) * (y - ya)) / (yb - ya) + xa) inside = !inside;
  }
  return inside;
};

function segDist2(x, y, x0, y0, x1, y1) {
  const dx = x1 - x0, dy = y1 - y0, L2 = dx * dx + dy * dy;
  let t = L2 > 0 ? ((x - x0) * dx + (y - y0) * dy) / L2 : 0;
  t = Math.max(0, Math.min(1, t));
  const ex = x - x0 - t * dx, ey = y - y0 - t * dy;
  return ex * ex + ey * ey;
}

/**
 * A test for being inside an operation's shape, its bounding box [x0, x1, y0, y1], and (for most
 * shapes) its spans: spans(y, out) fills out with x0, x1, x0', x1', ... where the row at height y
 * crosses the shape, sorted, and returns how many numbers it put there.  Rasterizing by spans
 * fills each run of samples at once and tests only the samples at its ends, which decides them
 * exactly as the test does (the spans need only be right to within a sample).  `each`: the spans
 * only bound the shape, and every sample in them must still be tested (a ring's sector).
 */
export function geometry(op) {
  switch (op.k) {
    case 'rect': return [(x, y) => x >= op.x0 && x < op.x1 && y >= op.y0 && y < op.y1, [op.x0, op.x1, op.y0, op.y1],
      (y, out) => { if (!(y >= op.y0 && y < op.y1)) return 0; out[0] = op.x0; out[1] = op.x1; return 2; }];
    case 'disk': return [(x, y) => (x - op.x) ** 2 + (y - op.y) ** 2 < op.r * op.r, [op.x - op.r, op.x + op.r, op.y - op.r, op.y + op.r],
      (y, out) => { const q = op.r * op.r - (y - op.y) ** 2; if (!(q > 0)) return 0; const s = Math.sqrt(q); out[0] = op.x - s; out[1] = op.x + s; return 2; }];
    case 'poly': {
      const xs = op.pts.map((p) => p[0]), ys = op.pts.map((p) => p[1]), pts = op.pts;
      // The crossings that inPoly counts, in the same arithmetic: inside between the first and
      // second, the third and fourth...
      const spans = (y, out) => {
        let m = 0;
        for (let a = 0, b = pts.length - 1; a < pts.length; b = a++) {
          const [xa, ya] = pts[a], [xb, yb] = pts[b];
          if ((ya > y) !== (yb > y)) out[m++] = ((xb - xa) * (y - ya)) / (yb - ya) + xa;
        }
        sortSmall(out, m);
        return m;
      };
      return [(x, y) => inPoly(pts, x, y), [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)], pts.length <= SPANS.length ? spans : null];
    }
    case 'seg': {   // a brush stroke: a capsule of radius r (small: tested sample by sample)
      const { x0, y0, x1, y1, r } = op;
      return [(x, y) => segDist2(x, y, x0, y0, x1, y1) < r * r, [Math.min(x0, x1) - r, Math.max(x0, x1) + r, Math.min(y0, y1) - r, Math.max(y0, y1) + r]];
    }
    case 'arc': {   // part of a ring: r0 <= rho < r1, a0 <= angle <= a1
      const { x, y, r0, r1, a0, a1 } = op;
      // The ring's two runs across the row, every sample in them tested for the angle.
      const spans = (py, out) => {
        const d2 = (py - y) ** 2, o = r1 * r1 - d2;
        if (!(o > 0)) return 0;
        const so = Math.sqrt(o), i = r0 * r0 - d2, si = i > 0 ? Math.sqrt(i) : 0;
        if (si === 0) { out[0] = x - so; out[1] = x + so; return 2; }
        out[0] = x - so; out[1] = x - si; out[2] = x + si; out[3] = x + so; return 4;
      };
      spans.each = true;
      return [(px, py) => {
        const rho2 = (px - x) ** 2 + (py - y) ** 2;
        if (rho2 < r0 * r0 || rho2 >= r1 * r1) return false;
        let a = Math.atan2(py - y, px - x);
        while (a < a0) a += 2 * Math.PI;
        return a <= a1;
      }, [x - r1, x + r1, y - r1, y + r1], spans];
    }
    case 'lens': {  // biconvex: the intersection of two disks of radius R, half-aperture h
      const { x, y, R, h } = op, sag = R - Math.sqrt(Math.max(0, R * R - h * h));
      const c = R - sag;
      return [(px, py) => Math.abs(py - y) < h && (px - x + c) ** 2 + (py - y) ** 2 < R * R && (px - x - c) ** 2 + (py - y) ** 2 < R * R,
        [x - sag, x + sag, y - h, y + h],
        (py, out) => {
          const q = R * R - (py - y) ** 2;
          if (!(Math.abs(py - y) < h) || !(q > 0)) return 0;
          const s = Math.sqrt(q), lo = x + c - s, hi = x - c + s;
          if (!(hi > lo)) return 0;
          out[0] = lo; out[1] = hi; return 2;
        }];
    }
    default: throw new Error(`unknown shape ${op.k}`);
  }
}

/** Sort the first m numbers of a (a handful: insertion sort). */
function sortSmall(a, m) {
  for (let i = 1; i < m; i++) { const v = a[i]; let j = i - 1; while (j >= 0 && a[j] > v) { a[j + 1] = a[j]; j--; } a[j + 1] = v; }
}
const SPANS = new Float64Array(64);

// --------------------------------------------------------------------------- preset shapes

const glassOf = (n) => ({ n });
/** Where the waveguides begin (2 wavelengths in from the left), and the bend's way in. */
export const GUIDE_START = (W) => -W / 2 + 2;
export const BEND_Y = (H) => -H / 2 + 1.6;
const METAL = { pec: true };

/** Rods of radius r on a square lattice of constant a filling [x0, x1] x [y0, y1], except
 *  those for which skip(col, row) is true. */
function rods(a, r, x0, x1, y0, y1, mat, skip = () => false) {
  const ops = [];
  if (!(a >= 0.05)) return ops;   // (a tiny lattice would be millions of rods; the demo keeps a >= 0.1)
  const c0 = Math.ceil(x0 / a - 1e-9), c1 = Math.floor(x1 / a + 1e-9), r0 = Math.ceil(y0 / a - 1e-9), r1 = Math.floor(y1 / a + 1e-9);
  for (let c = c0; c <= c1; c++) for (let q = r0; q <= r1; q++) if (!skip(c, q)) ops.push({ k: 'disk', x: c * a, y: q * a, r, mat });
  return ops;
}

/**
 * The shapes behind the shape buttons.  build(p, n, W, H) gives the operations for parameter p
 * and index n in a W x H box.  `n` is the default index (absent for metal shapes).
 */
export const SHAPES = {
  prism: { label: 'Prism', p: [2, 12, 7], pLabel: 'side (λ)', n: 1.5,
    build: (L, n) => { const h = (L * Math.sqrt(3)) / 2; return [{ k: 'poly', pts: [[-L / 2, -h / 3], [L / 2, -h / 3], [0, (2 * h) / 3]], mat: glassOf(n) }]; } },
  slab: { label: 'Slab', p: [0.1, 6, 2], pLabel: 'thickness (λ)', n: 1.5,
    build: (d, n, W, H) => [{ k: 'rect', x0: -d / 2, x1: d / 2, y0: -H, y1: H, mat: glassOf(n) }] },
  surface: { label: 'Surface', p: [-60, 60, 0], pLabel: 'tilt (°)', n: 1.5,
    build: (tilt, n, W, H) => {
      // Everything below a line through the origin tilted by `tilt` degrees.
      const t = Math.tan((tilt * Math.PI) / 180), R = 2 * (W + H);
      return [{ k: 'poly', pts: [[-R, -R * t], [R, R * t], [R, -R], [-R, -R]], mat: glassOf(n) }];
    } },
  gap: { label: 'Gap', p: [0, 2, 0.3], pLabel: 'gap (λ)', n: 1.5,
    build: (g, n, W, H) => [{ k: 'rect', x0: -W, x1: W, y0: -H, y1: -g / 2, mat: glassOf(n) }, { k: 'rect', x0: -W, x1: W, y0: g / 2, y1: H, mat: glassOf(n) }] },
  lens: { label: 'Lens', p: [1.5, 12, 5], pLabel: 'focal length (λ)', n: 1.5,
    // A symmetric biconvex lens whose thin-lens focal length is f: 1/f = (n - 1) 2/R.
    build: (f, n, W, H) => { const h = Math.min(0.3 * H, 2.5), R = Math.max(2 * (n - 1) * f, h * 1.02); return [{ k: 'lens', x: -W / 4, y: 0, R, h, mat: glassOf(n) }]; } },
  guide: { label: 'Waveguide', p: [0.1, 3, 0.5], pLabel: 'core width (λ)', n: 1.5,
    // A straight core along y = 0, from 2 wavelengths inside the box's left edge (so that a beam
    // can be sent into its end) out through the right edge.
    build: (w, n, W) => [{ k: 'rect', x0: GUIDE_START(W), x1: W, y0: -w / 2, y1: w / 2, mat: glassOf(n) }] },
  bend: { label: 'Bend', p: [0.3, 6, 2.5], pLabel: 'bend radius (λ)', n: 1.5,
    // A core 0.5 wide: in from the left along y = yc, a quarter circle of radius R (to the
    // middle of the core), out through the top.
    build: (R, n, W, H) => {
      const w = 0.5, xc = W / 2 - 2.2 - R, yc = BEND_Y(H), mat = glassOf(n);
      return [
        { k: 'rect', x0: GUIDE_START(W), x1: xc, y0: yc - w / 2, y1: yc + w / 2, mat },
        { k: 'arc', x: xc, y: yc + R, r0: R - w / 2, r1: R + w / 2, a0: -Math.PI / 2, a1: 0, mat },
        { k: 'rect', x0: xc + R - w / 2, x1: xc + R + w / 2, y0: yc + R, y1: H, mat },
      ];
    } },
  metalguide: { label: 'Metal guide', p: [0.1, 2, 0.4], pLabel: 'width (λ)',
    // A channel of width w, 4 wavelengths long, through a metal wall across the whole box.
    build: (w, n, W, H) => [
      { k: 'rect', x0: -2, x1: 2, y0: w / 2, y1: H, mat: METAL },
      { k: 'rect', x0: -2, x1: 2, y0: -H, y1: -w / 2, mat: METAL },
    ] },
  slits: { label: 'Two slits', p: [0.6, 6, 2.5], pLabel: 'separation (λ)',
    build: (d, n, W, H) => {
      const x0 = -W / 4, x1 = x0 + 0.25, s = 0.5;   // slits 0.5 λ wide
      const edges = [-H, -d / 2 - s / 2, -d / 2 + s / 2, d / 2 - s / 2, d / 2 + s / 2, H];
      const ops = [];
      for (let q = 0; q < edges.length; q += 2) ops.push({ k: 'rect', x0, x1, y0: edges[q], y1: edges[q + 1], mat: METAL });
      return ops;
    } },
  crystal: { label: 'Crystal', p: [0.15, 1, 0.37], pMin: 0.1, pLabel: 'lattice constant (λ)', n: 3,
    // A block of rods (radius a/5) on a square lattice.
    build: (a, n, W, H) => rods(a, a / 5, -0.5, 3.2, -H / 2 + 0.6, H / 2 - 0.6, glassOf(n)) },
  pcbend: { label: 'Crystal bend', p: [0.15, 1, 0.37], pMin: 0.1, pLabel: 'lattice constant (λ)', n: 3,
    // The same crystal over the whole box, with an L-shaped channel: one row missing from the
    // left up to the column nearest x = 1, then that column missing up to the top.
    build: (a, n, W, H) => {
      const cBend = Math.round(1 / a);
      return rods(a, a / 5, -W / 2 + 1.2, W / 2 - 0.6, -H / 2 + 0.6, H / 2 - 0.6, glassOf(n),
        (c, q) => (q === 0 && c <= cBend) || (c === cBend && q >= 0));
    } },
  cavity: { label: 'Cavity', p: [0, 0.6, 0.4], pLabel: 'opening (λ)',
    // A square metal box, 1/sqrt 2 wavelengths inside (its lowest TM mode is at the source's
    // frequency), walls 0.15 thick, with an opening in the middle of its right wall.
    build: (o) => {
      const s = Math.SQRT1_2 / 2, t = 0.15, ops = [
        { k: 'rect', x0: -s - t, x1: s + t, y0: s, y1: s + t, mat: METAL },
        { k: 'rect', x0: -s - t, x1: s + t, y0: -s - t, y1: -s, mat: METAL },
        { k: 'rect', x0: -s - t, x1: -s, y0: -s, y1: s, mat: METAL },
      ];
      if (o > 0) ops.push({ k: 'rect', x0: s, x1: s + t, y0: -s, y1: -o / 2, mat: METAL }, { k: 'rect', x0: s, x1: s + t, y0: o / 2, y1: s, mat: METAL });
      else ops.push({ k: 'rect', x0: s, x1: s + t, y0: -s, y1: s, mat: METAL });
      return ops;
    } },
  fill: { label: 'Fill', p: [0, 0, 0], n: 1.5,
    build: (p, n, W, H) => [{ k: 'rect', x0: -W, x1: W, y0: -H, y1: H, mat: glassOf(n) }] },
};

// --------------------------------------------------------------------------- the scene

export class Scene {
  /**
   * A box W x H (vacuum wavelengths) inside an absorbing layer of `pml` cells, with ppw cells
   * per wavelength.  W and H are rounded to whole cells.
   */
  constructor({ W = 16, H = 10, ppw = 20, pml = 16 } = {}) {
    this.ppw = ppw; this.dx = 1 / ppw; this.pml = pml;
    // An even number of cells each way, so that the origin is a corner of four cells and shapes
    // symmetric about it are drawn symmetrically.
    this.cw = 2 * Math.max(2, Math.round((W * ppw) / 2)); this.ch = 2 * Math.max(2, Math.round((H * ppw) / 2));
    this.W = this.cw / ppw; this.H = this.ch / ppw;
    this.nx = this.cw + 2 * pml; this.ny = this.ch + 2 * pml;
    this.x0 = -this.W / 2 - pml * this.dx; this.y0 = -this.H / 2 - pml * this.dx;
    this.fx = this.nx * SUB; this.fy = this.ny * SUB;
    this.fine = new Uint8Array(this.fx * this.fy);
    this.words = new Uint32Array(this.fine.buffer);   // a cell's four samples in a row, as one word
    this.bgEps = null;          // the background's eps on the fine grid, when it is not vacuum
    this.bgN = null;            // the function n(x, y) for it (arrays in, array out)
    this.shapeOps = []; this.paintOps = [];
    this.palette = [{ key: 'bg', eps: 1, sig: 0, pec: 0, bg: 1 }];
    const N = this.nx * this.ny;
    this.m = {};
    for (const f of ['nodeEps', 'nodeSig', 'aEps', 'aSig', 'bEps', 'bSig']) this.m[f] = new Float64Array(N);
    for (const f of ['nodePec', 'nodeTouch', 'aPec', 'bPec']) this.m[f] = new Uint8Array(N);
    this.version = 0;
  }

  /** The fine sample's coordinates, pulled back into the box (so that materials carry on into
   *  the absorbing layer). */
  fineX(p) { return Math.max(-this.W / 2, Math.min(this.W / 2, this.x0 + ((p + 0.5) * this.dx) / SUB)); }
  fineY(q) { return Math.max(-this.H / 2, Math.min(this.H / 2, this.y0 + ((q + 0.5) * this.dx) / SUB)); }

  materialId(mat) {
    const key = keyOf(mat);
    let id = this.palette.findIndex((p) => p.key === key);
    if (id >= 0) return id;
    if (this.palette.length >= 255) return 0;
    this.palette.push({ key, eps: mat.n ? mat.n * mat.n : 1, sig: mat.absorb ? SIGMA_ABSORBER : 0, pec: mat.pec ? 1 : 0, bg: mat.bg ? 1 : 0, n: mat.n });
    return this.palette.length - 1;
  }

  /** The background index n(x, y) (null for vacuum): fn(xs, ys) -> ns for Float64Arrays. */
  setBackground(fn) {
    this.bgN = fn;
    if (!fn) { this.bgEps = null; return; }
    const { fx, fy } = this;
    this.bgEps = new Float32Array(fx * fy);
    const xs = new Float64Array(fx), ys = new Float64Array(fx);
    for (let q = 0; q < fy; q++) {
      const yq = this.fineY(q);
      for (let p = 0; p < fx; p++) { xs[p] = this.fineX(p); ys[p] = yq; }
      const n = fn(xs, ys);
      for (let p = 0; p < fx; p++) { const v = n[p]; this.bgEps[q * fx + p] = Number.isFinite(v) ? Math.max(1, Math.min(6, v)) ** 2 : 1; }
    }
  }

  /** Draw an operation onto the fine grid; returns the cells it touched [i0, i1, j0, j1). */
  _raster(op) {
    if (op.k === 'path') {    // a brush stroke: segments between successive points
      let r = null;
      const p = op.pts;
      for (let q = 0; q + 3 < p.length || q === 0; q += 2) {
        const s = this._raster({ k: 'seg', x0: p[q], y0: p[q + 1], x1: p[q + 2] ?? p[q], y1: p[q + 3] ?? p[q + 1], r: op.r, mat: op.mat });
        if (s) r = r ? [Math.min(r[0], s[0]), Math.max(r[1], s[1]), Math.min(r[2], s[2]), Math.max(r[3], s[3])] : s;
        if (p.length <= 2) break;
      }
      return r;
    }
    const [inside, [bx0, bx1, by0, by1], spans] = geometry(op), id = this.materialId(op.mat);
    const { fx, fine, pml } = this, f = this.dx / SUB, X0 = this.x0;
    // Only the box itself; the layer copies its edges afterwards.
    const pLo = pml * SUB, pHi = (this.nx - pml) * SUB, qLo = pml * SUB, qHi = (this.ny - pml) * SUB;
    const p0 = Math.max(pLo, Math.floor((bx0 - X0) / f - 0.5)), p1 = Math.min(pHi, Math.ceil((bx1 - X0) / f + 0.5));
    const q0 = Math.max(qLo, Math.floor((by0 - this.y0) / f - 0.5)), q1 = Math.min(qHi, Math.ceil((by1 - this.y0) / f + 0.5));
    if (p1 <= p0 || q1 <= q0) return null;
    const xs = (p) => X0 + (p + 0.5) * f;      // the sample's x, exactly as the test is given it
    for (let q = q0; q < q1; q++) {
      const y = this.y0 + (q + 0.5) * f, row = q * fx;
      if (!spans) { for (let p = p0; p < p1; p++) if (inside(xs(p), y)) fine[row + p] = id; continue; }
      const m = spans(y, SPANS);
      for (let s = 0; s + 1 < m; s += 2) {
        // The samples p with SPANS[s] <= x_p < SPANS[s + 1], to within one; then the ends exactly.
        let a = Math.max(p0, Math.min(p1, Math.ceil((SPANS[s] - X0) / f - 0.5))), b = Math.max(a, Math.min(p1, Math.ceil((SPANS[s + 1] - X0) / f - 0.5)));
        if (spans.each) {
          for (let p = Math.max(p0, a - 1); p < Math.min(p1, b + 1); p++) if (inside(xs(p), y)) fine[row + p] = id;
          continue;
        }
        while (a > p0 && inside(xs(a - 1), y)) a--;
        while (a < b && !inside(xs(a), y)) a++;
        while (b < p1 && inside(xs(b), y)) b++;
        while (b > a && !inside(xs(b - 1), y)) b--;
        if (b > a) fine.fill(id, row + a, row + b);
      }
    }
    return [Math.floor(p0 / SUB), Math.ceil(p1 / SUB), Math.floor(q0 / SUB), Math.ceil(q1 / SUB)];
  }

  /** Copy the box's edge samples outwards through the absorbing layer. */
  _extend() {
    const { fx, fy, fine, pml } = this, lo = pml * SUB, hiX = fx - lo - 1, hiY = fy - lo - 1;
    for (let q = lo; q <= hiY; q++) {
      const row = q * fx;
      fine.fill(fine[row + lo], row, row + lo);
      fine.fill(fine[row + hiX], row + hiX + 1, row + fx);
    }
    for (let q = 0; q < lo; q++) fine.copyWithin(q * fx, lo * fx, lo * fx + fx);
    for (let q = hiY + 1; q < fy; q++) fine.copyWithin(q * fx, hiY * fx, hiY * fx + fx);
  }

  /** Rebuild everything from the shape and paint operations; returns the cells whose properties
   *  changed [i0, i1, j0, j1).  The fine grid is drawn again whole (a span at a time, which is
   *  quick), but the cells' properties are worked out again only where its samples changed: a
   *  slider that moves or turns a shape changes the cells along its outline.  When only the
   *  shapes' refractive indices have changed (the index slider), their outlines are the same:
   *  only their materials' values change, and only the cells holding them. */
  rebuild() {
    const geom = shapeOutlines(this.shapeOps), paints = this.paintOps.length;
    if (geom === this._geom && this.paintOps === this._paintRef && paints === this._paints && this._kept) {
      const retuned = this._retune();
      if (retuned) {
        const region = this._update(retuned, false);
        this._keptPal = this._paletteKeys();
        this.version++;
        return region;
      }
    }
    this.fine.fill(0);
    this.palette.length = 1;
    for (const op of this.shapeOps) this._raster(op);
    for (const op of this.paintOps) this._raster(op);
    this._extend();
    const keys = this._paletteKeys();
    let region;
    if (this._kept && this.bgEps === this._keptBg) {
      // The cells whose samples changed, and those holding a material that is not what it was.
      region = this._update(new Set(keys.map((k, id) => (k === this._keptPal[id] ? -1 : id)).filter((id) => id >= 0)), true);
    } else { this._properties(0, this.nx, 0, this.ny); region = [0, this.nx, 0, this.ny]; }
    this._kept = this._kept || new Uint8Array(this.fine.length);
    this._kept.set(this.fine); this._keptPal = keys; this._keptBg = this.bgEps;
    this._geom = geom; this._paintRef = this.paintOps; this._paints = paints;
    this._shapeIds = this.shapeOps.map((op) => this.materialId(op.mat));
    this._paintIds = new Set(this.paintOps.map((op) => this.materialId(op.mat)));
    this.version++;
    return region;
  }

  /** What each palette entry is, as strings by id: properties worked out under another palette
   *  must be worked out again where the entries that changed are used. */
  _paletteKeys() { return this.palette.map((p) => `${p.eps},${p.sig},${p.pec},${p.bg}`); }

  /** The id of the material filling all of cell k's samples, or -1 if it holds more than one. */
  _uniform(k) {
    const w = this.words, nx = this.nx, i = k % nx, base = ((k - i) * SUB) + i, v = w[base];
    if (w[base + nx] !== v || w[base + 2 * nx] !== v || w[base + 3 * nx] !== v || (v & 255) * 0x01010101 !== v) return -1;
    return v & 255;
  }

  /**
   * Work out the properties again where they may have changed: in the cells whose fine samples
   * differ from those the properties were last worked out from (diff), and in those that hold any
   * of the palette entries `ids` (a Set).  A node depends on its own cell; the edges on the top
   * and right of a cell look into the cell above or to the right too.  Returns the cells changed.
   */
  _update(ids, diff) {
    const { nx, ny, fine } = this, N = nx * ny;
    const chg = this._chg && this._chg.length === N ? this._chg.fill(0) : (this._chg = new Uint8Array(N));
    let any = false;
    if (diff) {
      // The four samples across a cell in one row of the fine grid are one 32-bit word (SUB = 4).
      const a = this.words, b = new Uint32Array(this._kept.buffer, this._kept.byteOffset, fine.length >> 2);
      for (let q = 0; q < this.fy; q++) {
        const row = q * nx, crow = (q >> 2) * nx;
        for (let i = 0; i < nx; i++) if (a[row + i] !== b[row + i]) { chg[crow + i] = 1; any = true; }
      }
    }
    if (ids.size) {
      const hit = new Uint8Array(256), fx = this.fx;
      for (const id of ids) hit[id] = 1;
      for (let k = 0; k < N; k++) {
        if (chg[k]) continue;
        const u = this._uniform(k);
        if (u >= 0) { if (hit[u]) { chg[k] = 1; any = true; } continue; }
        const i = k % nx, row0 = ((k - i) * SUB) * SUB + i * SUB;
        for (let q = 0; q < SUB && !chg[k]; q++) for (let p = 0; p < SUB; p++) if (hit[fine[row0 + q * fx + p]]) { chg[k] = 1; any = true; break; }
      }
    }
    if (!any) return [0, 0, 0, 0];
    const T = this._tables();
    for (let k = 0; k < N; k++) if (chg[k]) this._node(k % nx, (k / nx) | 0, T);
    let i0 = nx, i1 = 0, j0 = ny, j1 = 0;
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      if (!(chg[k] || (j + 1 < ny && chg[k + nx]) || (i + 1 < nx && chg[k + 1]))) continue;
      this._edges(i, j, T);
      if (i < i0) i0 = i;
      if (i >= i1) i1 = i + 1;
      if (j < j0) j0 = j;
      if (j >= j1) j1 = j + 1;
    }
    // (Which cells' own samples changed, for the pictures of the materials; valid until the next
    // rebuild.)
    const region = [i0, i1, j0, j1];
    region.cells = chg;
    return region;
  }

  /** Give the shapes' palette entries their new indices, if that alone is the change and it can be
   *  done (each entry still one material, none shared with paint): the ids changed (a Set, maybe
   *  empty); false: rebuild instead. */
  _retune() {
    if (!this._shapeIds || this._shapeIds.length !== this.shapeOps.length) return false;
    const next = new Map();
    for (let i = 0; i < this.shapeOps.length; i++) {
      const id = this._shapeIds[i], mat = this.shapeOps[i].mat, key = keyOf(mat);
      if (next.has(id) ? next.get(id).key !== key : false) return false;
      const was = this.palette[id];
      if (!was || was.pec !== (mat.pec ? 1 : 0) || was.bg !== (mat.bg ? 1 : 0) || (was.sig !== 0) !== !!mat.absorb) return false;
      if (was.key !== key && this._paintIds.has(id)) return false;
      next.set(id, { key, mat });
    }
    // No two entries may end up the same material (materialId would have merged them).
    const keys = new Set();
    for (const [id, { key }] of next) { if (keys.has(key) || this.palette.some((p, j) => j !== id && !next.has(j) && p.key === key)) return false; keys.add(key); }
    const changed = new Set();
    for (const [id, { key, mat }] of next) {
      if (this.palette[id].key !== key) changed.add(id);
      Object.assign(this.palette[id], { key, eps: mat.n ? mat.n * mat.n : 1, n: mat.n });
    }
    return changed;
  }

  setShapes(ops) { this.shapeOps = ops; return this.rebuild(); }

  /** Paint one more operation on top; returns the cells whose properties changed. */
  paint(op) {
    this.paintOps.push(op);
    return this.stroke(op);
  }

  /** Draw an operation on top without keeping it (a piece of a stroke that is kept whole
   *  elsewhere); returns the cells whose properties changed. */
  stroke(op) {
    this._geom = null;          // (the fine grid now holds more than the last rebuild drew)
    const r = this._raster(op);
    if (!r) return null;
    let [i0, i1, j0, j1] = r;
    const { pml, nx, ny } = this;
    // Touching the edge of the box: the absorbing layer beyond it changes too.
    if (i0 <= pml + 1 || j0 <= pml + 1 || i1 >= nx - pml - 1 || j1 >= ny - pml - 1) {
      this._extend();
      if (i0 <= pml + 1) i0 = 0;
      if (j0 <= pml + 1) j0 = 0;
      if (i1 >= nx - pml - 1) i1 = nx;
      if (j1 >= ny - pml - 1) j1 = ny;
    }
    i0 = Math.max(0, i0 - 1); j0 = Math.max(0, j0 - 1); i1 = Math.min(nx, i1 + 1); j1 = Math.min(ny, j1 + 1);
    this._properties(i0, i1, j0, j1);
    // The properties follow the fine grid in this region now: so must the copy kept of it.
    if (this._kept) {
      const { fx } = this, S = SUB;
      for (let q = j0 * S; q < j1 * S; q++) this._kept.set(this.fine.subarray(q * fx + i0 * S, q * fx + i1 * S), q * fx + i0 * S);
    }
    this.version++;
    return [i0, i1, j0, j1];
  }

  clearPaint() { this.paintOps = []; return this.rebuild(); }

  /** The palette as lookup tables by id. */
  _tables() {
    const T = this._t || (this._t = { eps: new Float64Array(256), sig: new Float64Array(256), pec: new Uint8Array(256), bg: new Uint8Array(256) });
    this.palette.forEach((p, id) => { T.eps[id] = p.eps; T.sig[id] = p.sig; T.pec[id] = p.pec; T.bg[id] = p.bg; });
    return T;
  }

  /** The properties of cells [i0, i1) x [j0, j1) and of the edges that look into them. */
  _properties(i0, i1, j0, j1) {
    const T = this._tables();
    // Nodes first (the edges need their neighbours' metal flags).
    for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) this._node(i, j, T);
    const jj1 = Math.min(j1 + 1, this.ny), ii1 = Math.min(i1 + 1, this.nx);
    for (let j = Math.max(0, j0 - 1); j < jj1; j++) for (let i = Math.max(0, i0 - 1); i < ii1; i++) this._edges(i, j, T);
  }

  /** The node of cell (i, j): the mean eps of its samples that are not metal; metal if half of
   *  them are (nodeTouch if any is); the mean conductivity. */
  _node(i, j, T) {
    const { fx, fine, bgEps, m } = this, S = SUB, { eps, sig, pec, bg } = T;
    const u = this._uniform(j * this.nx + i);
    if (u >= 0 && !(bg[u] && bgEps)) {
      // One material (the usual case): its own values.
      const k = j * this.nx + i;
      m.nodePec[k] = m.nodeTouch[k] = pec[u] ? 1 : 0;
      m.nodeEps[k] = pec[u] ? 1 : eps[u];
      m.nodeSig[k] = sig[u];
      return;
    }
    let sE = 0, sS = 0, np = 0, cnt = 0;
    for (let q = 0; q < S; q++) {
      const row = (j * S + q) * fx + i * S;
      for (let p = 0; p < S; p++) {
        const f = row + p, id = fine[f];
        sS += sig[id];
        if (pec[id]) np++; else { sE += bg[id] && bgEps ? bgEps[f] : eps[id]; cnt++; }
      }
    }
    const k = j * this.nx + i;
    m.nodePec[k] = 2 * np >= S * S ? 1 : 0;
    m.nodeTouch[k] = np > 0 ? 1 : 0;
    m.nodeEps[k] = cnt ? sE / cnt : 1;
    m.nodeSig[k] = sS / (S * S);
  }

  /** Edge a, at the middle of the top of cell (i, j) (E along x in TE), and edge b, its right
   *  side (E along y): over a cell-sized window centred on each, the mean of eps across the
   *  field (arithmetic), then along it (harmonic); the mean conductivity; metal where a node it
   *  joins is. */
  _edges(i, j, T) {
    const { bgEps, m, nx } = this, S = SUB, H = S / 2, { eps, sig, pec, bg } = T, k = j * nx + i;
    m.aPec[k] = m.nodePec[k] || (j + 1 < this.ny && m.nodePec[k + nx]) ? 1 : 0;
    m.bPec[k] = m.nodePec[k] || (i + 1 < nx && m.nodePec[k + 1]) ? 1 : 0;
    // One material over the whole window (the usual case): its own values.
    const w = this.words, wa = (j * S + H) * nx + i, va = w[wa];
    let ua = -1;
    if (j + 1 < this.ny && w[wa + nx] === va && w[wa + 2 * nx] === va && w[wa + 3 * nx] === va && (va & 255) * 0x01010101 === va) ua = va & 255;
    const u0 = i + 1 < nx ? this._uniform(k) : -1, ub = u0 >= 0 && this._uniform(k + 1) === u0 ? u0 : -1;
    if (ua >= 0 && !(bg[ua] && bgEps)) { m.aEps[k] = pec[ua] ? 1 : eps[ua]; m.aSig[k] = sig[ua]; }
    else this._window(i * S, j * S + H, true, k, T);
    if (ub >= 0 && !(bg[ub] && bgEps)) { m.bEps[k] = pec[ub] ? 1 : eps[ub]; m.bSig[k] = sig[ub]; }
    else this._window(i * S + H, j * S, false, k, T);
  }

  /** The general case of an edge's window, from its lower-left sample (pa, qa): along x (edge a)
   *  or y (edge b). */
  _window(pa, qa, alongX, k, T) {
    const { fx, fy, fine, bgEps, m } = this, S = SUB, { eps, sig, pec, bg } = T;
    if (alongX) {
      let inv = 0, sS = 0;
      for (let u = 0; u < S; u++) {
        const p = Math.min(fx - 1, pa + u);
        let s = 0, c = 0;
        for (let v = 0; v < S; v++) {
          const f = Math.min(fy - 1, qa + v) * fx + p, id = fine[f];
          sS += sig[id];
          if (!pec[id]) { s += bg[id] && bgEps ? bgEps[f] : eps[id]; c++; }
        }
        inv += c ? c / s : 1;
      }
      m.aEps[k] = S / inv; m.aSig[k] = sS / (S * S);
      return;
    }
    let inv = 0, sS = 0;
    for (let u = 0; u < S; u++) {
      const q = Math.min(fy - 1, qa + u);
      let s = 0, c = 0;
      for (let v = 0; v < S; v++) {
        const f = q * fx + Math.min(fx - 1, pa + v), id = fine[f];
        sS += sig[id];
        if (!pec[id]) { s += bg[id] && bgEps ? bgEps[f] : eps[id]; c++; }
      }
      inv += c ? c / s : 1;
    }
    m.bEps[k] = S / inv; m.bSig[k] = sS / (S * S);
  }

  /** The material at a point: { n, pec, absorb }. */
  materialAt(x, y) {
    const p = Math.floor(((x - this.x0) / this.dx) * SUB), q = Math.floor(((y - this.y0) / this.dx) * SUB);
    if (p < 0 || q < 0 || p >= this.fx || q >= this.fy) return { n: 1 };
    const f = q * this.fx + p, mat = this.palette[this.fine[f]];
    if (mat.pec) return { pec: true, n: Infinity };
    if (mat.sig) return { absorb: true, n: 1 };
    if (mat.bg) return { n: this.bgEps ? Math.sqrt(this.bgEps[f]) : 1 };
    return { n: Math.sqrt(mat.eps) };
  }

  /** The largest index inside the box (what sets the finest wavelength). */
  maxIndex() {
    let e = 1;
    const { fx, pml, palette, words, nx } = this, lo = pml * SUB, hiX = this.fx - lo, hiY = this.fy - lo;
    const used = new Uint8Array(256);
    // A word at a time (a cell's four samples in a row), and its bytes only where they differ.
    for (let q = lo; q < hiY; q++) {
      for (let i = pml, w = q * nx + pml; i < nx - pml; i++, w++) {
        const v = words[w];
        if ((v & 255) * 0x01010101 === v) used[v & 255] = 1;
        else { used[v & 255] = used[(v >>> 8) & 255] = used[(v >>> 16) & 255] = used[v >>> 24] = 1; }
      }
    }
    palette.forEach((m, id) => { if (used[id] && !m.pec && !m.bg) e = Math.max(e, m.eps); });
    if (this.bgEps && palette.some((m, id) => used[id] && m.bg)) for (let q = lo; q < hiY; q++) for (let p = lo; p < hiX; p++) e = Math.max(e, this.bgEps[q * fx + p]);
    return Math.sqrt(e);
  }

  /** Apply the properties of cells [i0, i1) x [j0, j1) (all by default) to a solver. */
  applyTo(sim, region = [0, this.nx, 0, this.ny]) {
    const [i0, i1, j0, j1] = region;
    sim.setMaterials(this.m, i0, i1, j0, j1);
  }
}
