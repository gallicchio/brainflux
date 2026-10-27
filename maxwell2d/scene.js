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

/** A test for being inside an operation's shape, and its bounding box [x0, x1, y0, y1]. */
function geometry(op) {
  switch (op.k) {
    case 'rect': return [(x, y) => x >= op.x0 && x < op.x1 && y >= op.y0 && y < op.y1, [op.x0, op.x1, op.y0, op.y1]];
    case 'disk': return [(x, y) => (x - op.x) ** 2 + (y - op.y) ** 2 < op.r * op.r, [op.x - op.r, op.x + op.r, op.y - op.r, op.y + op.r]];
    case 'poly': {
      const xs = op.pts.map((p) => p[0]), ys = op.pts.map((p) => p[1]);
      return [(x, y) => inPoly(op.pts, x, y), [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]];
    }
    case 'seg': {   // a brush stroke: a capsule of radius r
      const { x0, y0, x1, y1, r } = op;
      return [(x, y) => segDist2(x, y, x0, y0, x1, y1) < r * r, [Math.min(x0, x1) - r, Math.max(x0, x1) + r, Math.min(y0, y1) - r, Math.max(y0, y1) + r]];
    }
    case 'arc': {   // part of a ring: r0 <= rho < r1, a0 <= angle <= a1
      const { x, y, r0, r1, a0, a1 } = op;
      return [(px, py) => {
        const rho2 = (px - x) ** 2 + (py - y) ** 2;
        if (rho2 < r0 * r0 || rho2 >= r1 * r1) return false;
        let a = Math.atan2(py - y, px - x);
        while (a < a0) a += 2 * Math.PI;
        return a <= a1;
      }, [x - r1, x + r1, y - r1, y + r1]];
    }
    case 'lens': {  // biconvex: the intersection of two disks of radius R, half-aperture h
      const { x, y, R, h } = op, sag = R - Math.sqrt(Math.max(0, R * R - h * h));
      const c = R - sag;
      return [(px, py) => Math.abs(py - y) < h && (px - x + c) ** 2 + (py - y) ** 2 < R * R && (px - x - c) ** 2 + (py - y) ** 2 < R * R,
        [x - sag, x + sag, y - h, y + h]];
    }
    default: throw new Error(`unknown shape ${op.k}`);
  }
}

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
  crystal: { label: 'Crystal', p: [0.15, 1, 0.37], pLabel: 'lattice constant (λ)', n: 3,
    // A block of rods (radius a/5) on a square lattice.
    build: (a, n, W, H) => rods(a, a / 5, -0.5, 3.2, -H / 2 + 0.6, H / 2 - 0.6, glassOf(n)) },
  pcbend: { label: 'Crystal bend', p: [0.15, 1, 0.37], pLabel: 'lattice constant (λ)', n: 3,
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
    const [inside, [bx0, bx1, by0, by1]] = geometry(op), id = this.materialId(op.mat);
    const { fx, fine, pml } = this, f = this.dx / SUB;
    // Only the box itself; the layer copies its edges afterwards.
    const pLo = pml * SUB, pHi = (this.nx - pml) * SUB, qLo = pml * SUB, qHi = (this.ny - pml) * SUB;
    const p0 = Math.max(pLo, Math.floor((bx0 - this.x0) / f - 0.5)), p1 = Math.min(pHi, Math.ceil((bx1 - this.x0) / f + 0.5));
    const q0 = Math.max(qLo, Math.floor((by0 - this.y0) / f - 0.5)), q1 = Math.min(qHi, Math.ceil((by1 - this.y0) / f + 0.5));
    if (p1 <= p0 || q1 <= q0) return null;
    for (let q = q0; q < q1; q++) {
      const y = this.y0 + (q + 0.5) * f, row = q * fx;
      for (let p = p0; p < p1; p++) if (inside(this.x0 + (p + 0.5) * f, y)) fine[row + p] = id;
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

  /** Rebuild everything from the shape and paint operations. */
  rebuild() {
    this.fine.fill(0);
    this.palette.length = 1;
    for (const op of this.shapeOps) this._raster(op);
    for (const op of this.paintOps) this._raster(op);
    this._extend();
    this._properties(0, this.nx, 0, this.ny);
    this.version++;
    return [0, this.nx, 0, this.ny];
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
    this.version++;
    return [i0, i1, j0, j1];
  }

  clearPaint() { this.paintOps = []; return this.rebuild(); }

  _properties(i0, i1, j0, j1) {
    const { fx, fy, fine, nx, palette, bgEps, m } = this, S = SUB, H = S / 2;
    const eps = new Float64Array(256), sig = new Float64Array(256), pec = new Uint8Array(256), bg = new Uint8Array(256);
    palette.forEach((p, id) => { eps[id] = p.eps; sig[id] = p.sig; pec[id] = p.pec; bg[id] = p.bg; });
    const epsAt = (f) => { const id = fine[f]; return bg[id] && bgEps ? bgEps[f] : eps[id]; };
    // Nodes first (the edges need their neighbours' metal flags).
    for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) {
      let sE = 0, sS = 0, np = 0, cnt = 0;
      for (let q = 0; q < S; q++) {
        const row = (j * S + q) * fx + i * S;
        for (let p = 0; p < S; p++) {
          const f = row + p, id = fine[f];
          sS += sig[id];
          if (pec[id]) np++; else { sE += epsAt(f); cnt++; }
        }
      }
      const k = j * nx + i;
      m.nodePec[k] = 2 * np >= S * S ? 1 : 0;
      m.nodeTouch[k] = np > 0 ? 1 : 0;
      m.nodeEps[k] = cnt ? sE / cnt : 1;
      m.nodeSig[k] = sS / (S * S);
    }
    // Edge a, at the middle of the top of cell (i, j): E along x (TE); edge b, the right side: E along y.
    const window = (pa, qa, along) => {
      // Mean of eps across the field (arithmetic), then along it (harmonic); mean conductivity.
      let inv = 0, sS = 0;
      for (let u = 0; u < S; u++) {
        let s = 0, c = 0;
        for (let v = 0; v < S; v++) {
          const p = Math.min(fx - 1, along === 'x' ? pa + u : pa + v), q = Math.min(fy - 1, along === 'x' ? qa + v : qa + u);
          const f = q * fx + p, id = fine[f];
          sS += sig[id];
          if (!pec[id]) { s += epsAt(f); c++; }
        }
        inv += c ? c / s : 1;
      }
      return [S / inv, sS / (S * S)];
    };
    const jj1 = Math.min(j1 + 1, this.ny), ii1 = Math.min(i1 + 1, nx);
    for (let j = Math.max(0, j0 - 1); j < jj1; j++) for (let i = Math.max(0, i0 - 1); i < ii1; i++) {
      const k = j * nx + i;
      [m.aEps[k], m.aSig[k]] = window(i * S, j * S + H, 'x');
      [m.bEps[k], m.bSig[k]] = window(i * S + H, j * S, 'y');
      m.aPec[k] = m.nodePec[k] || (j + 1 < this.ny && m.nodePec[k + nx]) ? 1 : 0;
      m.bPec[k] = m.nodePec[k] || (i + 1 < nx && m.nodePec[k + 1]) ? 1 : 0;
    }
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
    const { fx, pml, fine, palette } = this, lo = pml * SUB, hiX = this.fx - lo, hiY = this.fy - lo;
    const used = new Uint8Array(256);
    for (let q = lo; q < hiY; q++) for (let p = lo; p < hiX; p++) used[fine[q * fx + p]] = 1;
    palette.forEach((m, id) => { if (used[id] && !m.pec && !m.bg) e = Math.max(e, m.eps); });
    if (used[0] && this.bgEps) for (let q = lo; q < hiY; q++) for (let p = lo; p < hiX; p++) e = Math.max(e, this.bgEps[q * fx + p]);
    return Math.sqrt(e);
  }

  /** Apply the properties of cells [i0, i1) x [j0, j1) (all by default) to a solver. */
  applyTo(sim, region = [0, this.nx, 0, this.ny]) {
    const [i0, i1, j0, j1] = region;
    sim.setMaterials(this.m, i0, i1, j0, j1);
  }
}
