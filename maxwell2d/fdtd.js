// Maxwell's equations in two dimensions by the finite-difference time-domain method (Yee, 1966).
//
// Units: c = 1, eps0 = mu0 = 1 (so the impedance of vacuum is 1), lengths in vacuum wavelengths
// of the source and time in its periods: f = 1, omega = 2 pi.
//
// One kernel serves both polarisations.  A "node" field u sits at the centre of each cell and two
// "edge" fields on the cell's edges, a at the middle of its top edge (i, j + 1/2) and b at the
// middle of its right edge (i + 1/2, j):
//     m_a da/dt = -du/dy,    m_b db/dt = du/dx,    m_u du/dt = db/dx - da/dy
//   TM (Ez, Hx, Hy):  u = Ez,  a = Hx,  b = Hy,  m_u = eps, m_a = m_b = mu = 1
//   TE (Hz, Ex, Ey):  u = Hz,  a = -Ex, b = -Ey, m_u = mu = 1, m_a = m_b = eps
// (Maxwell's equations keep their form under E -> H, H -> -E, eps <-> mu.)  In TM the electric
// field is along z, parallel to every interface in the plane; in TE it lies in the plane.
//
// Leapfrog in time: the edges at half steps, the nodes at whole steps.  Every coefficient is an
// array, so materials (eps, conductivity, perfect conductor) can be anything cell by cell; losses
// are semi-implicit, stable for any conductivity.  The grid is surrounded by a convolutional PML
// (Roden and Gedney 2000; polynomial grading of order 3 with a complex frequency shift), which
// absorbs outgoing waves at any angle and from any medium that runs into it.

export const COURANT = 0.5;          // c dt / dx (the 2D limit is 1/sqrt 2)
export const OMEGA = 2 * Math.PI;    // the source's angular frequency

// --------------------------------------------------------------------------- time dependence

export const RAMP = 2;               // CW sources fade in over this many periods
export const PULSE = { width: 0.9, delay: 3 };   // Gaussian envelope exp(-((t - delay w)/w)^2)

/** The source's time dependence at time tau after it was switched on. */
export function waveform(kind, tau) {
  if (tau <= 0) return 0;
  if (kind === 'pulse') {
    const s = tau - PULSE.delay * PULSE.width, x = s / PULSE.width;
    return x > 7 ? 0 : Math.exp(-x * x) * Math.sin(OMEGA * s);
  }
  const ramp = tau < RAMP ? 0.5 * (1 - Math.cos((Math.PI * tau) / RAMP)) : 1;
  return kind === 'steady' ? ramp : ramp * Math.sin(OMEGA * tau);
}

/** True while a source of this kind still emits (a pulse is over after 2 delays). */
export function isOn(kind, tau) { return kind !== 'pulse' || tau < 2 * PULSE.delay * PULSE.width; }

// --------------------------------------------------------------------------- the grid

export class Yee2D {
  /**
   *   nx, ny     cells
   *   dx         cell size (vacuum wavelengths)
   *   pml        absorbing cells on each side (0 for none: the edges are then perfect mirrors)
   *   periodicX, periodicY   wrap around instead (no PML on that axis)
   *   x0, y0     the coordinates of the grid's lower-left corner: node (i, j) is at
   *              (x0 + (i + 1/2) dx, y0 + (j + 1/2) dx)
   *   mode       'TM' or 'TE'
   *   precision  64 or 32 bits for the fields (32 halves the memory traffic, which is what
   *              limits the speed of a big grid)
   */
  constructor({ nx, ny, dx, pml = 16, periodicX = false, periodicY = false, x0 = 0, y0 = 0, mode = 'TM', courant = COURANT, precision = 64 }) {
    Object.assign(this, { nx, ny, dx, x0, y0, mode });
    this.dt = courant * dx;
    this.px = periodicX; this.py = periodicY;
    this.pmlX = periodicX ? 0 : pml; this.pmlY = periodicY ? 0 : pml;
    const N = nx * ny, F = precision === 32 ? Float32Array : Float64Array;
    this.u = new F(N); this.a = new F(N); this.b = new F(N);
    const k0 = this.dt / dx;
    this.Cu = new Float32Array(N).fill(1); this.Ku = new Float32Array(N).fill(k0);
    this.Ca = new Float32Array(N).fill(1); this.Ka = new Float32Array(N).fill(k0);
    this.Cb = new Float32Array(N).fill(1); this.Kb = new Float32Array(N).fill(k0);
    this.psiUx = new F(N); this.psiUy = new F(N); this.psiA = new F(N); this.psiB = new F(N);
    this.F = F;
    this._lossy();
    this.t = 0; this.steps = 0;
    this.sources = []; this.monitors = [];
    this.intensity = null;   // the time average of u^2, when asked for (trackIntensity)
    this._pmlTables();
  }

  /** Steps per period (an integer when 1/dx is). */
  get stepsPerPeriod() { return Math.round(1 / this.dt); }

  /** Coordinates of node (i, j). */
  nodeX(i) { return this.x0 + (i + 0.5) * this.dx; }
  nodeY(j) { return this.y0 + (j + 0.5) * this.dx; }

  clear() {
    for (const f of [this.u, this.a, this.b, this.psiUx, this.psiUy, this.psiA, this.psiB]) f.fill(0);
    if (this.intensity) this.intensity.fill(0);
    this.t = 0; this.steps = 0;
    for (const m of this.monitors) m.reset?.();
  }

  // ------------------------------------------------------------------- materials

  /**
   * Coefficients from material properties, for cells i0 <= i < i1, j0 <= j < j1 (all by default).
   *   m: { nodeEps, nodeSig, nodePec, nodeTouch, aEps, aSig, aPec, bEps, bSig, bPec } arrays of nx * ny
   * eps is the relative permittivity, sig a conductivity (1/time) applied to both the electric
   * and the magnetic field (a lossy medium matched to vacuum when eps = 1), pec 1 for a perfect
   * conductor.  In TM, eps and pec act on the nodes (Ez); in TE on the edges (Ex, Ey).
   * Where a metal surface lies is then known to half a cell.  In TE the tangential E is zero on
   * the edges of every cell that is mostly metal: the surface is placed to within half a cell
   * either way.  In TM, Ez is zero at the centre of every cell that the metal touches at all
   * (nodeTouch): the surface is again within half a cell either way, where requiring the cell
   * to be mostly metal would put it half a cell inside the metal on average.
   */
  setMaterials(m, i0 = 0, i1 = this.nx, j0 = 0, j1 = this.ny) {
    const { nx, dt, dx } = this, TM = this.mode === 'TM';
    const set = (C, K, k, eps, sig, pec) => {
      if (pec) { C[k] = 0; K[k] = 0; return; }
      const f = (sig * dt) / (2 * eps);
      C[k] = (1 - f) / (1 + f); K[k] = dt / (eps * dx) / (1 + f);
    };
    for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) {
      const k = j * nx + i;
      if (TM) {
        set(this.Cu, this.Ku, k, m.nodeEps[k], m.nodeSig[k], m.nodeTouch ? m.nodeTouch[k] : m.nodePec[k]);
        set(this.Ca, this.Ka, k, 1, m.aSig[k], 0);
        set(this.Cb, this.Kb, k, 1, m.bSig[k], 0);
      } else {
        set(this.Cu, this.Ku, k, 1, m.nodeSig[k], m.nodePec[k]);
        set(this.Ca, this.Ka, k, m.aEps[k], m.aSig[k], m.aPec[k]);
        set(this.Cb, this.Kb, k, m.bEps[k], m.bSig[k], m.bPec[k]);
      }
    }
    this._lossy();
  }

  // Most cells are lossless (C = 1): the main loops leave C out, and the few lossy ones (the
  // absorber, metal) are scaled by C beforehand, from these lists.
  _lossy() {
    const list = (C) => { const idx = []; for (let k = 0; k < C.length; k++) if (C[k] !== 1) idx.push(k); return Int32Array.from(idx); };
    this.lossU = list(this.Cu); this.lossA = list(this.Ca); this.lossB = list(this.Cb);
  }

  /** The relative permittivity the node field sees at cell k (TM), or the edges (TE). */
  epsAt(k) {
    const K = this.mode === 'TM' ? this.Ku[k] : this.Ka[k];
    return K > 0 ? this.dt / (this.dx * K) : Infinity;
  }

  // ------------------------------------------------------------------- the absorbing layer

  _pmlTables() {
    const { nx, ny, dx, dt } = this, m = 3;
    // sigma_max = 0.8 (m + 1) / (eta dx) is the classic optimum for a polynomial grading;
    // alpha (the complex frequency shift) keeps the layer from reflecting slow, nearly static
    // fields and keeps it stable at late times.
    const sigmaMax = (0.8 * (m + 1)) / dx, alphaMax = 0.2 * OMEGA;
    const table = (n, P, offset) => {
      const bt = new Float64Array(n).fill(1), ct = new Float64Array(n);
      if (!P) return [bt, ct];
      const L = P * dx;
      for (let i = 0; i < n; i++) {
        const x = (i + offset) * dx;
        const d = Math.max((L - x) / L, (x - (n * dx - L)) / L);
        if (d <= 0) continue;
        const sigma = sigmaMax * d ** m, alpha = alphaMax * (1 - d);
        bt[i] = Math.exp(-(sigma + alpha) * dt);
        ct[i] = (sigma / (sigma + alpha)) * (bt[i] - 1);
      }
      return [bt, ct];
    };
    [this.bxU, this.cxU] = table(nx, this.pmlX, 0.5);   // nodes: x = (i + 1/2) dx
    [this.bxB, this.cxB] = table(nx, this.pmlX, 1);     // b edges: x = (i + 1) dx
    [this.byU, this.cyU] = table(ny, this.pmlY, 0.5);
    [this.byA, this.cyA] = table(ny, this.pmlY, 1);
  }

  // ------------------------------------------------------------------- stepping

  step() {
    const { nx, ny, u, a, b } = this;
    scale(a, this.Ca, this.lossA); scale(b, this.Cb, this.lossB);
    updateEdges(nx, ny, u, a, b, this.Ka, this.Kb, this.px, this.py);
    if (this.pmlY) pmlEdgesY(nx, ny, this.pmlY, u, a, this.Ka, this.psiA, this.byA, this.cyA);
    if (this.pmlX) pmlEdgesX(nx, ny, this.pmlX, u, b, this.Kb, this.psiB, this.bxB, this.cxB);
    for (const s of this.sources) s.edges?.(this, this.t);

    const track = this.intensity && this.averageEveryStep;
    if (track) this._uPrev.set(u);
    scale(u, this.Cu, this.lossU);
    updateNodes(nx, ny, u, a, b, this.Ku, this.px, this.py);
    if (this.pmlX) pmlNodesX(nx, ny, this.pmlX, u, b, this.Ku, this.psiUx, this.bxU, this.cxU);
    if (this.pmlY) pmlNodesY(nx, ny, this.pmlY, u, a, this.Ku, this.psiUy, this.byU, this.cyU);
    for (const s of this.sources) s.nodes?.(this, this.t + this.dt / 2);

    this.t += this.dt; this.steps++;
    if (track) this.accumulate(Math.min(1, this.dt / this._avgPeriods));
    for (const m of this.monitors) m.record(this);
  }

  run(steps) { for (let s = 0; s < steps; s++) this.step(); }

  // ------------------------------------------------------------------- averages

  /**
   * Keep a running time average of u^2 (over about `periods` periods), every step; or, with
   * everyStep false, whenever the caller asks: beginAverage() before a step, accumulate(w) after
   * it (a demo does it once a frame, which is cheaper and, for a steady wave, just as good).
   */
  trackIntensity(on, periods = 1, everyStep = true) {
    if (!on) { this.intensity = null; this._uPrev = null; return; }
    if (!this.intensity) { this.intensity = new this.F(this.u.length); this._uPrev = new this.F(this.u.length); }
    this._avgPeriods = periods; this.averageEveryStep = everyStep;
  }
  beginAverage() { if (this._uPrev) this._uPrev.set(this.u); }

  // For a field oscillating at the source frequency, u = A cos(wt + phi), the mean of u^2 is
  // A^2/2 = (u^2 + (du/dt / w)^2)/2 at every instant: averaging that has no ripple at 2w.  Using
  // u and du/dt half a step apart, the factors 1/cos^2 and x^2/sin^2 (x = w dt/2) make it exact.
  accumulate(w) {
    const { u, intensity: I } = this, p = this._uPrev, x = (OMEGA * this.dt) / 2;
    if (!I) return;
    const c1 = 0.25 / Math.cos(x) ** 2, c2 = 1 / (4 * Math.sin(x) ** 2);
    for (let k = 0; k < u.length; k++) {
      const s = u[k] + p[k], d = u[k] - p[k];
      I[k] += w * (0.5 * (c1 * s * s + c2 * d * d) - I[k]);
    }
  }

  // ------------------------------------------------------------------- measurements

  /** Field u at a point, interpolated between the four nearest nodes. */
  sample(x, y, f = this.u) {
    const fi = (x - this.x0) / this.dx - 0.5, fj = (y - this.y0) / this.dx - 0.5;
    const i = Math.floor(fi), j = Math.floor(fj), tx = fi - i, ty = fj - j, { nx, ny } = this;
    if (i < 0 || j < 0 || i + 1 >= nx || j + 1 >= ny) return 0;
    const k = j * nx + i;
    return (f[k] * (1 - tx) + f[k + 1] * tx) * (1 - ty) + (f[k + nx] * (1 - tx) + f[k + nx + 1] * tx) * ty;
  }

  /**
   * The Poynting vector E x H at node k: [Sx, Sy].  The edges are interpolated onto the node
   * through four points (cubic), since a two-point average would shrink a wave by
   * cos(k dx/2), 1% at 20 cells a wavelength.  (Node k must be 2 cells from the grid's edge.)
   * TM: S = Ez z x (Hx, Hy) = (-Ez Hy, Ez Hx).  TE: S = (Ex, Ey) x Hz z = (Ey Hz, -Ex Hz),
   * which with a = -Ex, b = -Ey is the same formula.
   */
  poyntingAt(k) {
    const { u, a, b, nx } = this, n2 = 2 * nx;
    const bb = (9 * (b[k] + b[k - 1]) - b[k - 2] - b[k + 1]) / 16;
    const aa = (9 * (a[k] + a[k - nx]) - a[k - n2] - a[k + nx]) / 16;
    return [-u[k] * bb, u[k] * aa];
  }

  /**
   * The electromagnetic energy per unit length in z: (1/2) sum (eps E^2 + mu H^2) dx^2, with the
   * edge fields taken as the product of their values half a step before and after: for the
   * energy at step n, pass u at step n and the edges before that step (aPrev, bPrev) after
   * calling step().  That is the quantity the Yee scheme conserves exactly.
   */
  energy(u = this.u, aPrev = this.a, bPrev = this.b) {
    const { a, b, Ku, Ka, Kb, dt, dx } = this;
    let W = 0;
    for (let k = 0; k < u.length; k++) {
      if (Ku[k] > 0) W += (u[k] * u[k] * dt) / (Ku[k] * dx);
      if (Ka[k] > 0) W += (a[k] * aPrev[k] * dt) / (Ka[k] * dx);
      if (Kb[k] > 0) W += (b[k] * bPrev[k] * dt) / (Kb[k] * dx);
    }
    return 0.5 * W * dx * dx;
  }
}

// --------------------------------------------------------------------------- the kernels
// Plain functions of typed arrays (small and monomorphic, so the JIT compiles them well).

// The lossy cells' decay, f -> C f, before the main update.
function scale(f, C, idx) { for (let m = 0; m < idx.length; m++) f[idx[m]] *= C[idx[m]]; }

// The edges, from the differences of u: a along y, b along x.  Beyond the grid u = 0.
function updateEdges(nx, ny, u, a, b, Ka, Kb, px, py) {
  const last = nx - 1;
  for (let j = 0; j < ny - 1; j++) {
    const row = j * nx, end = row + last;
    for (let k = row; k < end; k++) {
      const uk = u[k];
      a[k] -= Ka[k] * (u[k + nx] - uk);
      b[k] += Kb[k] * (u[k + 1] - uk);
    }
    a[end] -= Ka[end] * (u[end + nx] - u[end]);
    b[end] += Kb[end] * ((px ? u[row] : 0) - u[end]);
  }
  const row = (ny - 1) * nx;
  for (let i = 0; i < nx; i++) {
    const k = row + i;
    a[k] -= Ka[k] * ((py ? u[i] : 0) - u[k]);
    b[k] += Kb[k] * ((i < last ? u[k + 1] : px ? u[row] : 0) - u[k]);
  }
}

// The nodes, from the curl of the edges.  Beyond the grid the edges are 0.
function updateNodes(nx, ny, u, a, b, Ku, px, py) {
  const last = nx - 1;
  for (let j = 0; j < ny; j++) {
    const row = j * nx, end = row + last;
    const down = j > 0 ? row - nx : py ? (ny - 1) * nx : -1;
    u[row] += Ku[row] * ((b[row] - (px ? b[end] : 0)) - (a[row] - (down >= 0 ? a[down] : 0)));
    if (down >= 0) {
      const off = row - down;
      for (let k = row + 1; k <= end; k++) u[k] += Ku[k] * ((b[k] - b[k - 1]) - (a[k] - a[k - off]));
    } else {
      for (let k = row + 1; k <= end; k++) u[k] += Ku[k] * ((b[k] - b[k - 1]) - a[k]);
    }
  }
}

// The PML: psi accumulates the convolution of the derivative with the layer's response, and is
// added to the derivative.  Rows j < P and j >= ny - P; columns likewise.
function pmlEdgesY(nx, ny, P, u, a, Ka, psi, bt, ct) {
  for (let j = 0; j < ny; j = j === P - 1 ? ny - P : j + 1) {
    const row = j * nx, B = bt[j], C = ct[j], top = j === ny - 1;
    for (let k = row; k < row + nx; k++) {
      psi[k] = B * psi[k] + C * ((top ? 0 : u[k + nx]) - u[k]);
      a[k] -= Ka[k] * psi[k];
    }
  }
}
function pmlEdgesX(nx, ny, P, u, b, Kb, psi, bt, ct) {
  for (let j = 0; j < ny; j++) {
    const row = j * nx;
    for (let i = 0; i < nx; i = i === P - 1 ? nx - P : i + 1) {
      const k = row + i;
      psi[k] = bt[i] * psi[k] + ct[i] * ((i < nx - 1 ? u[k + 1] : 0) - u[k]);
      b[k] += Kb[k] * psi[k];
    }
  }
}
function pmlNodesX(nx, ny, P, u, b, Ku, psi, bt, ct) {
  for (let j = 0; j < ny; j++) {
    const row = j * nx;
    for (let i = 0; i < nx; i = i === P - 1 ? nx - P : i + 1) {
      const k = row + i;
      psi[k] = bt[i] * psi[k] + ct[i] * (b[k] - (i > 0 ? b[k - 1] : 0));
      u[k] += Ku[k] * psi[k];
    }
  }
}
function pmlNodesY(nx, ny, P, u, a, Ku, psi, bt, ct) {
  for (let j = 0; j < ny; j = j === P - 1 ? ny - P : j + 1) {
    const row = j * nx, B = bt[j], C = ct[j];
    for (let k = row; k < row + nx; k++) {
      psi[k] = B * psi[k] + C * (a[k] - (j > 0 ? a[k - nx] : 0));
      u[k] -= Ku[k] * psi[k];
    }
  }
}

// --------------------------------------------------------------------------- sources

/** Node index and bilinear weights for a point: [[k, w], ...]. */
function bilinear(sim, x, y) {
  const fi = (x - sim.x0) / sim.dx - 0.5, fj = (y - sim.y0) / sim.dx - 0.5;
  const i = Math.floor(fi), j = Math.floor(fj), tx = fi - i, ty = fj - j, out = [];
  for (const [di, dj, w] of [[0, 0, (1 - tx) * (1 - ty)], [1, 0, tx * (1 - ty)], [0, 1, (1 - tx) * ty], [1, 1, tx * ty]]) {
    const ii = i + di, jj = j + dj;
    if (ii >= 0 && jj >= 0 && ii < sim.nx && jj < sim.ny && w > 0) out.push([jj * sim.nx + ii, w]);
  }
  return out;
}

/**
 * A line current along z (TM: an electric current, an antenna wire; TE: a magnetic current)
 * through the point (x, y): J = I(t) delta(r - r0), spread over the four nearest nodes.
 * wave: 'cw' (switched on smoothly at t0), 'pulse' (a Gaussian pulse fired at t0).
 */
export class PointSource {
  constructor({ x = 0, y = 0, wave = 'cw', t0 = 0, amp = 1 } = {}) {
    Object.assign(this, { type: 'point', x, y, wave, t0, amp });
  }
  prepare(sim) { this.w = bilinear(sim, this.x, this.y); }
  nodes(sim, t) {
    if (!this.w) this.prepare(sim);
    const I = this.amp * waveform(this.wave, t - this.t0);
    if (I === 0) return;
    for (const [k, w] of this.w) sim.u[k] -= (sim.Ku[k] * I * w) / sim.dx;
  }
}

/**
 * A source moving in a straight line at speed beta (in units of c) from (x, y) in the direction
 * `angle` (radians), with its current spread over a small Gaussian (radius `size`) so that it
 * moves smoothly across the grid.  wave: 'steady' (a constant current, switched on smoothly: a
 * moving wire, the analogue of a moving charge) or 'cw' (an oscillating source: the Doppler
 * effect).  When it leaves the box [xmin, xmax] x [ymin, ymax] it starts again.
 */
export class MovingSource {
  constructor({ x = 0, y = 0, angle = 0, beta = 0.9, wave = 'steady', t0 = 0, amp = 1, size = 0.1, box = null } = {}) {
    Object.assign(this, { type: 'moving', x, y, angle, beta, wave, t0, amp, size, box });
  }
  position(t) {
    const s = this.beta * Math.max(0, t - this.t0);
    return [this.x + s * Math.cos(this.angle), this.y + s * Math.sin(this.angle)];
  }
  nodes(sim, t) {
    let [x, y] = this.position(t);
    const b = this.box;
    if (b && (x < b[0] || x > b[1] || y < b[2] || y > b[3])) { this.t0 = t; [x, y] = [this.x, this.y]; }
    const I = this.amp * waveform(this.wave, t - this.t0);
    if (I === 0) return;
    const s = Math.max(this.size, 0.75 * sim.dx), R = Math.ceil((3 * s) / sim.dx);
    const ci = Math.round((x - sim.x0) / sim.dx - 0.5), cj = Math.round((y - sim.y0) / sim.dx - 0.5);
    const ks = [], ws = [];
    let total = 0;
    for (let j = cj - R; j <= cj + R; j++) {
      if (j < 0 || j >= sim.ny) continue;
      for (let i = ci - R; i <= ci + R; i++) {
        if (i < 0 || i >= sim.nx) continue;
        const dx = sim.nodeX(i) - x, dy = sim.nodeY(j) - y, w = Math.exp(-(dx * dx + dy * dy) / (2 * s * s));
        if (w < 1e-4) continue;
        ks.push(j * sim.nx + i); ws.push(w); total += w;
      }
    }
    for (let m = 0; m < ks.length; m++) sim.u[ks[m]] -= (sim.Ku[ks[m]] * I * ws[m]) / (total * sim.dx);
  }
}

/** The wavenumber the Yee grid gives a plane wave of frequency 1 travelling at `angle` in a
 *  medium of index n: sin^2(w dt/2) = (dt/n dx)^2 [sin^2(kx dx/2) + sin^2(ky dx/2)]. */
export function numericalK(n, angle, dx, dt) {
  const target = ((n * dx) / dt) ** 2 * Math.sin((OMEGA * dt) / 2) ** 2;
  const c = Math.cos(angle), s = Math.sin(angle);
  let k = n * OMEGA;
  for (let it = 0; it < 30; it++) {
    const F = Math.sin((k * c * dx) / 2) ** 2 + Math.sin((k * s * dx) / 2) ** 2 - target;
    const dF = (dx / 2) * (c * Math.sin(k * c * dx) + s * Math.sin(k * s * dx));
    const step = F / dF;
    k -= step;
    if (Math.abs(step) < 1e-14 * k) break;
  }
  return k;
}

/**
 * A beam: a Gaussian beam with its waist (1/e amplitude half-width `width`) centred on (x, y),
 * travelling at `angle`, in a medium of index n, injected by the total-field / scattered-field
 * method.  The boundary is the line through (x, y) perpendicular to the beam, 3.2 widths each
 * way, followed on the grid as a staircase: in front of it there is the beam plus everything
 * scattered, behind it only what is scattered back.  Every edge whose two nodes lie on opposite
 * sides of the line is corrected: the field on one side must not see the incident part of the
 * other (or must see it, the other way round), so the line itself is invisible to the light
 * that comes back through it.  The incident field is the beam in the paraxial approximation,
 * with the grid's own wavenumber and impedances at the source frequency, so a CW plane wave is
 * injected exactly and a beam leaks very little.  The line must lie in a uniform medium.
 */
export class BeamSource {
  constructor({ x = 0, y = 0, angle = 0, width = 1, wave = 'cw', t0 = 0, amp = 1, n = 1, halfLength = null } = {}) {
    Object.assign(this, { type: 'beam', x, y, angle, width, wave, t0, amp, n, halfLength });
  }

  /** The ends of the injection line. */
  ends() {
    const L = this.halfLength ?? 3.2 * this.width, px = -Math.sin(this.angle), py = Math.cos(this.angle);
    return [[this.x - L * px, this.y - L * py], [this.x + L * px, this.y + L * py]];
  }

  prepare(sim) {
    const { dx, dt, nx } = sim, n = this.n, phi = this.angle;
    const c = Math.cos(phi), s = Math.sin(phi);
    const k = numericalK(n, phi, dx, dt), kOverW = k / OMEGA;
    const Kmed = sim.mode === 'TM' ? dt / dx : dt / (n * n * dx);   // the edges' coefficient in this medium
    const sw = Math.sin((OMEGA * dt) / 2);
    // A plane wave on the grid has b/u = -K sin(kx dx/2)/sin(w dt/2) and a/u = +K sin(ky dx/2)/sin(w dt/2).
    const ratioB = (-Kmed * Math.sin((k * c * dx) / 2)) / sw, ratioA = (Kmed * Math.sin((k * s * dx) / 2)) / sw;
    // The energy flux of such a wave, as the scheme conserves it (see FluxLine), per unit A^2
    // and along the beam.
    const ct = Math.cos((OMEGA * dt) / 2);
    this.fluxPerA2 = 0.5 * ct * (-ratioB * Math.cos((k * c * dx) / 2) * c + ratioA * Math.cos((k * s * dx) / 2) * s);
    const L = this.halfLength ?? 3.2 * this.width, w2 = this.width * this.width;
    const along = (x, y) => (x - this.x) * c + (y - this.y) * s;
    const perp = (x, y) => -(x - this.x) * s + (y - this.y) * c;
    // Nodes inside the box (not in the absorbing layer) near the line.
    const [[xa, ya], [xb, yb]] = this.ends();
    const ci = (x) => Math.round((x - sim.x0) / dx - 0.5), cj = (y) => Math.round((y - sim.y0) / dx - 0.5);
    const clampI = (i) => Math.max(-1, Math.min(nx, i)), clampJ = (j) => Math.max(-1, Math.min(sim.ny, j));
    const i0 = Math.max(sim.pmlX, clampI(Math.min(ci(xa), ci(xb))) - 2), i1 = Math.min(nx - sim.pmlX - 1, clampI(Math.max(ci(xa), ci(xb))) + 2);
    const j0 = Math.max(sim.pmlY, clampJ(Math.min(cj(ya), cj(yb))) - 2), j1 = Math.min(sim.ny - sim.pmlY - 1, clampJ(Math.max(cj(ya), cj(yb))) + 2);
    const eIdx = [], eIsA = [], eF = [], eAmp = [], eDel = [];     // edge updates, with the node's incident field
    const nIdx = [], nF = [], nAmp = [], nDel = [];                // node updates, with the edge's incident field
    const pair = (kp, xp, yp, kq, xq, yq, ke, isA) => {
      // p is the lower/left node, q the upper/right one.  In the edge's update u_q has
      // coefficient +K (b) or -K (a), u_p the opposite; in the nodes' updates the edge has
      // coefficient -Ku in q's and +Ku in p's for b, and +Ku in q's, -Ku in p's for a.
      const sp = along(xp, yp), sq = along(xq, yq);
      if ((sp >= 0) === (sq >= 0)) return;
      const xe = (xp + xq) / 2, ye = (yp + yq) / 2, pe = perp(xe, ye);
      if (Math.abs(pe) > L) return;
      const edgeTF = along(xe, ye) >= 0, nodeTF = !edgeTF;
      // The node on the other side from the edge.
      const dIsQ = (sq >= 0) !== edgeTF, kd = dIsQ ? kq : kp, xd = dIsQ ? xq : xp, yd = dIsQ ? yq : yp;
      // Edge update: remove the incident part of a total-field node, or add it to a scattered one.
      const cEdge = (isA ? -1 : 1) * (dIsQ ? 1 : -1), pd = perp(xd, yd);
      eIdx.push(ke); eIsA.push(isA ? 1 : 0); eF.push(cEdge * (nodeTF ? -1 : 1));
      eAmp.push(Math.exp(-(pd * pd) / w2)); eDel.push(kOverW * along(xd, yd));
      // Node update: a total-field node must see the incident part of a scattered-field edge
      // (and a scattered-field node must not see that of a total-field edge).
      const cNode = (isA ? 1 : -1) * (dIsQ ? 1 : -1);
      nIdx.push(kd); nF.push(cNode * (nodeTF ? 1 : -1) * (isA ? ratioA : ratioB));
      nAmp.push(Math.exp(-(pe * pe) / w2)); nDel.push(kOverW * along(xe, ye));
    };
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const k = j * nx + i, x = sim.nodeX(i), y = sim.nodeY(j);
      if (i < i1) pair(k, x, y, k + 1, x + dx, y, k, false);
      if (j < j1) pair(k, x, y, k + nx, x, y + dx, k, true);
    }
    Object.assign(this, {
      eIdx: Int32Array.from(eIdx), eIsA: Uint8Array.from(eIsA), eF: Float64Array.from(eF), eAmp: Float64Array.from(eAmp), eDel: Float64Array.from(eDel),
      nIdx: Int32Array.from(nIdx), nF: Float64Array.from(nF), nAmp: Float64Array.from(nAmp), nDel: Float64Array.from(nDel), prepared: sim,
    });
  }

  edges(sim, t) {
    if (this.prepared !== sim) this.prepare(sim);
    const { eIdx, eIsA, eF, eAmp, eDel } = this, T = t - this.t0;
    for (let m = 0; m < eIdx.length; m++) {
      const e = eIdx[m], g = waveform(this.wave, T - eDel[m]);
      if (g === 0) continue;
      if (eIsA[m]) sim.a[e] += eF[m] * sim.Ka[e] * this.amp * eAmp[m] * g;
      else sim.b[e] += eF[m] * sim.Kb[e] * this.amp * eAmp[m] * g;
    }
  }

  nodes(sim, t) {
    const { nIdx, nF, nAmp, nDel } = this, T = t - this.t0;
    for (let m = 0; m < nIdx.length; m++) {
      const g = waveform(this.wave, T - nDel[m]);
      if (g !== 0) sim.u[nIdx[m]] += nF[m] * sim.Ku[nIdx[m]] * this.amp * nAmp[m] * g;
    }
  }

  /**
   * The time-averaged power the beam carries (per unit length in z), for a CW beam: the
   * integral of n A^2/2 (TM) or A^2/(2n) (TE) across a waist of 1/e half-width w.  Once the
   * beam is on a grid, the grid's version of that, as FluxLine measures it: a plane wave there
   * carries cos(k dx/2) cos(w dt/2) times as much (per component of k), 0.5% less at 20 cells
   * a wavelength.
   */
  power(mode = 'TM') {
    const across = this.width * Math.sqrt(Math.PI / 2) * this.amp * this.amp;
    if (this.fluxPerA2 !== undefined) return this.fluxPerA2 * across;
    return mode === 'TM' ? (this.n * across) / 2 : across / (2 * this.n);
  }
}

// --------------------------------------------------------------------------- monitors

/** The field u at a point, every step, in a ring buffer. */
export class Probe {
  constructor({ x = 0, y = 0, capacity = 1 << 14 } = {}) {
    Object.assign(this, { x, y });
    this.values = new Float32Array(capacity); this.times = new Float64Array(capacity);
    this.count = 0;
  }
  reset() { this.count = 0; }
  record(sim) {
    const c = this.values.length, o = this.count % c;
    this.values[o] = sim.sample(this.x, this.y); this.times[o] = sim.t;
    this.count++;
  }
  /** The last n samples in time order: { t, v }. */
  last(n = this.values.length) {
    const c = this.values.length, m = Math.min(n, this.count, c);
    const t = new Float64Array(m), v = new Float64Array(m);
    for (let q = 0; q < m; q++) { const o = (this.count - m + q) % c; t[q] = this.times[o]; v[q] = this.values[o]; }
    return { t, v };
  }
}

/**
 * The flow of energy through a line segment from (x0, y0) to (x1, y1), towards the right of the
 * direction from the first point to the second.  It is measured exactly as the Yee scheme
 * conserves energy: the line is followed on the grid as a staircase of cell faces, and across
 * each face the flux is the edge field times the mean of the node fields on either side, each
 * averaged over the half steps before and after it (-b u for x, a u for y).  So the flows into
 * and out of any region add up exactly, whatever the materials.  `power` is its average over the
 * last period, `energy` its integral over time since the last reset.
 */
export class FluxLine {
  constructor({ x0, y0, x1, y1, label = '' }) {
    Object.assign(this, { x0, y0, x1, y1, label });
    this.reset();
  }
  reset() { this.ring = null; this.sum = 0; this.filled = 0; this.energy = 0; this.power = 0; this.instant = 0; this.sim = null; }
  _prepare(sim) {
    const { dx, nx } = sim, L = Math.hypot(this.x1 - this.x0, this.y1 - this.y0) || 1e-9;
    const tx = (this.x1 - this.x0) / L, ty = (this.y1 - this.y0) / L, mx = (this.x0 + this.x1) / 2, my = (this.y0 + this.y1) / 2;
    const side = (x, y) => (x - mx) * ty - (y - my) * tx >= 0;          // the normal (ty, -tx) side
    const along = (x, y) => (x - mx) * tx + (y - my) * ty;
    const ci = (x) => Math.round((x - sim.x0) / dx - 0.5), cj = (y) => Math.round((y - sim.y0) / dx - 0.5);
    const i0 = Math.max(1, Math.min(ci(this.x0), ci(this.x1)) - 2), i1 = Math.min(nx - 2, Math.max(ci(this.x0), ci(this.x1)) + 2);
    const j0 = Math.max(1, Math.min(cj(this.y0), cj(this.y1)) - 2), j1 = Math.min(sim.ny - 2, Math.max(cj(this.y0), cj(this.y1)) + 2);
    const faces = [];   // [edge index, 1 for a (y) or 0 for b (x), node p, node q, sign]
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const k = j * nx + i, x = sim.nodeX(i), y = sim.nodeY(j), sp = side(x, y);
      for (const [isA, kq, xq, yq] of [[0, k + 1, x + dx, y], [1, k + nx, x, y + dx]]) {
        if ((isA ? j + 1 > j1 : i + 1 > i1)) continue;
        const sq = side(xq, yq);
        if (sp === sq || Math.abs(along((x + xq) / 2, (y + yq) / 2)) > L / 2) continue;
        faces.push([k, isA, k, kq, sq ? 1 : -1]);   // flowing from p to q (along +x or +y) counts if q is on the normal side
      }
    }
    this.faces = faces;
    const nodes = [...new Set(faces.flatMap((f) => [f[2], f[3]]))];
    this.nodeIndex = new Map(nodes.map((k, m) => [k, m]));
    this.nodes = Int32Array.from(nodes);
    this.prev = Float64Array.from(nodes, (k) => sim.u[k]);
    this.ring = new Float64Array(sim.stepsPerPeriod); this.sum = 0; this.filled = 0;
    this.sim = sim;
  }
  record(sim) {
    if (this.sim !== sim) this._prepare(sim);
    const { u, a, b } = sim, prev = this.prev, idx = this.nodeIndex;
    let F = 0;
    for (const [e, isA, p, q, sign] of this.faces) {
      const up = 0.5 * (u[p] + prev[idx.get(p)]), uq = 0.5 * (u[q] + prev[idx.get(q)]);
      F += sign * 0.5 * (up + uq) * (isA ? a[e] : -b[e]);
    }
    for (let m = 0; m < this.nodes.length; m++) prev[m] = u[this.nodes[m]];
    F *= sim.dx;
    const o = this.filled % this.ring.length;
    this.sum += F - this.ring[o]; this.ring[o] = F; this.filled++;
    this.instant = F;
    this.power = this.sum / Math.min(this.filled, this.ring.length);
    this.energy += F * sim.dt;
  }
}

/** The Poynting vector averaged over about a period at a set of nodes (for drawing arrows). */
export class FlowField {
  constructor(nodes) { this.nodes = Int32Array.from(nodes); this.sx = new Float64Array(nodes.length); this.sy = new Float64Array(nodes.length); }
  reset() { this.sx.fill(0); this.sy.fill(0); }
  record(sim) {
    const w = Math.min(1, sim.dt);
    for (let m = 0; m < this.nodes.length; m++) {
      const [sx, sy] = sim.poyntingAt(this.nodes[m]);
      this.sx[m] += w * (sx - this.sx[m]); this.sy[m] += w * (sy - this.sy[m]);
    }
  }
}
