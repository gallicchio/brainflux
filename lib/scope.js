// Oscilloscope traces, drawn the way a digital phosphor oscilloscope draws them.
//
// A trace with far more samples than the screen has pixels can't be drawn as a line: through
// the samples it is a scribble, and as each pixel column's lowest-to-highest sample (the old way,
// "min/max") it is all or nothing, and it beats against the pixel grid wherever a column holds
// part of a cycle.  A digital phosphor scope instead counts how long the trace spends in every
// pixel and lights each in proportion: a slow line is solid, a fast edge is faint, a band of
// many cycles is a glow that is brightest at its turning points, where the trace lingers.
//
//   scopeTrace(ctx, frame, { n, y, x0, x1, color })   draws n samples evenly spaced from x0 to x1
//                                                     (drawing coordinates; y a function or array)
//
// A trace with fewer than about one and a half samples per pixel is a line, and is drawn as one
// (the canvas anti-aliases lines); only a denser one is graded, as below.
//
// Each piece of the trace between two samples deposits its time over the pixels it crosses, split
// at column boundaries and spread over the rows it covers with fractional coverage at the ends
// (anti-aliased in both directions), so the trace is continuous and nothing is drawn at a whole
// pixel's brightness that the trace only grazes.  A pixel's brightness is its relative density,
// min(1, gain D S)^gamma, D the fraction of the column's time spent in it and S the column's
// height of trace in pixels: 1 wherever the trace spends its time evenly (a line, however steep),
// more where it lingers (the turning points of a band), less where it races (a fast edge, the
// middle of a band), but never less than a floor wherever the trace passed, so a brief spike
// still shows.  With bandlimited: true, a trace with fewer than two samples per pixel is first interpolated as a band-limited signal is (a Lanczos
// windowed sinc: what a scope's sin(x)/x interpolation does), so peaks between samples come out.
//
// The page can be switched to the old, cheaper drawing for slow machines with ?scope=fast in its
// address (or localStorage 'brainflux.scope' = 'fast'); scopeMode() says which is in use.

let MODE = 'graded';
try {
  const q = new URLSearchParams(location.search).get('scope');
  MODE = q || localStorage.getItem('brainflux.scope') || 'graded';
} catch { /* no location or storage (tests, private windows): the default */ }
if (MODE !== 'fast') MODE = 'graded';

/** 'graded' (the default) or 'fast' (per-column min/max, the old way). */
export const scopeMode = () => MODE;
export function setScopeMode(m) { MODE = m === 'fast' ? 'fast' : 'graded'; }

const LANCZOS_A = 4;
function lanczos(x) {
  if (x === 0) return 1;
  if (x <= -LANCZOS_A || x >= LANCZOS_A) return 0;
  const p = Math.PI * x;
  return (LANCZOS_A * Math.sin(p) * Math.sin(p / LANCZOS_A)) / (p * p);
}

/** v (length n) interpolated k times more finely, as a band-limited signal: (n - 1) k + 1 values. */
export function upsample(v, n, k) {
  const m = (n - 1) * k + 1, out = new Float64Array(m), taps = 2 * LANCZOS_A;
  const wt = new Float64Array(k * taps);              // the weights for each phase j/k between samples
  for (let ph = 1; ph < k; ph++) {
    let sum = 0;
    for (let q = 0; q < taps; q++) { const w = lanczos(ph / k - (q - LANCZOS_A + 1)); wt[ph * taps + q] = w; sum += w; }
    for (let q = 0; q < taps; q++) wt[ph * taps + q] /= sum;
  }
  for (let j = 0; j < m; j++) {
    const i = Math.floor(j / k), ph = j - i * k;
    if (ph === 0) { out[j] = v[i]; continue; }
    let s = 0;
    for (let q = 0, b = ph * taps; q < taps; q++) {
      const qq = i - LANCZOS_A + 1 + q;
      s += wt[b + q] * v[qq < 0 ? 0 : qq >= n ? n - 1 : qq];
    }
    out[j] = s;
  }
  return out;
}

/**
 * The time each pixel of a W x H grid (device pixels) holds the trace through the points
 * (X[i], Y[i]), i < n, added to D[c H + r] (column by column) in units of a column's duration, so
 * that a column the trace crosses in full sums to 1.  half: half the trace's thickness beyond one
 * pixel.  Each piece's time is shared between the two columns nearest its middle (a tent two
 * columns wide, which is what keeps a trace with one or two pixels per cycle from beating against
 * the pixel grid), and spread over the rows it crosses by their overlap.  touch (optional, like D)
 * gets the line's coverage of each pixel (overlap times the tent's share, summed over pieces),
 * however briefly the trace was there; ext (length 2W) each column's lowest and highest row
 * touched (Infinity, -Infinity for none).  Each piece costs the same however many rows it
 * crosses: the rows between its ends go into a difference array, summed down each column's
 * touched rows at the end.  rev (optional, length W) gets the number of samples in each column
 * where the trace turns.  Pure (no DOM): the unit tests check it.  Returns [r0, r1], the rows
 * touched in any column.
 */
export function depositTrace(D, W, H, X, Y, n, half = 0, ext = null, touch = null, work = null, rev = null) {
  let r0 = H, r1 = -1;
  if (!ext) ext = new Float64Array(2 * W);
  if (rev) {                                           // each column's turning points (for shadeTrace's smoothing)
    rev.fill(0, 0, W);
    for (let i = 1; i + 1 < n; i++) {
      const c = Math.floor(X[i]);
      if (c >= 0 && c < W && (Y[i] - Y[i - 1]) * (Y[i + 1] - Y[i]) < 0) rev[c]++;
    }
  }
  if (!work || work.dD.length < W * (H + 1)) work = { dD: new Float32Array(W * (H + 1)), dT: new Float32Array(W * (H + 1)) };
  const dD = work.dD, dT = work.dT, G = H + 1;        // (the difference arrays have a spare row)
  for (let c = 0; c < W; c++) { ext[2 * c] = Infinity; ext[2 * c + 1] = -Infinity; }
  for (let i = 0; i + 1 < n; i++) {
    let xa = X[i], xb = X[i + 1], ya = Y[i], yb = Y[i + 1];
    if (!(Number.isFinite(xa) && Number.isFinite(xb) && Number.isFinite(ya) && Number.isFinite(yb))) continue;
    if (xb < xa) { let t = xa; xa = xb; xb = t; t = ya; ya = yb; yb = t; }
    if (xb <= -1 || xa >= W + 1) continue;
    const dx = xb - xa, slope = dx > 0 ? (yb - ya) / dx : 0;
    const c0 = Math.max(-1, Math.floor(xa)), c1 = Math.min(W, Math.floor(dx > 0 ? xb - 1e-9 : xb));
    for (let cc = c0; cc <= c1; cc++) {
      const xs = xa > cc ? xa : cc, xe = xb < cc + 1 ? xb : cc + 1;
      const wgt = dx > 0 ? xe - xs : 1;               // (a vertical piece: a whole column's worth)
      if (!(wgt > 0)) continue;
      let lo, hi;
      if (dx > 0) { lo = ya + slope * (xs - xa); hi = ya + slope * (xe - xa); } else { lo = ya; hi = yb; }
      if (lo > hi) { const t = lo; lo = hi; hi = t; }
      if (hi - lo < 1) { const m = (lo + hi) / 2; lo = m - 0.5; hi = m + 0.5; }
      lo -= half; hi += half;
      const dens = wgt / (hi - lo), a = lo < 0 ? 0 : lo, b = hi > H ? H : hi;
      if (!(b > a)) continue;
      const ra = Math.floor(a), rb = Math.floor(b);       // rb may be H: the piece runs off the bottom
      const xm = (xs + xe) / 2 - 0.5, cl = Math.floor(xm), fr = xm - cl;
      for (let side = 0; side < 2; side++) {
        const c = cl + side, share = side ? fr : 1 - fr;
        if (c < 0 || c >= W || !(share > 0)) continue;
        const dd = dens * share, k0 = c * H;
        if (ra === rb) {
          const ov = b - a;
          D[k0 + ra] += dd * ov; if (touch) touch[k0 + ra] += share * ov;
        } else {
          let ov = ra + 1 - a;
          D[k0 + ra] += dd * ov; if (touch) touch[k0 + ra] += share * ov;
          if (rb < H && b > rb) { ov = b - rb; D[k0 + rb] += dd * ov; if (touch) touch[k0 + rb] += share * ov; }
          if (rb > ra + 1) { const g = c * G; dD[g + ra + 1] += dd; dT[g + ra + 1] += share; dD[g + rb] -= dd; dT[g + rb] -= share; }
        }
        if (a < ext[2 * c]) ext[2 * c] = a;
        if (b > ext[2 * c + 1]) ext[2 * c + 1] = b;
      }
    }
  }
  for (let c = 0; c < W; c++) {
    if (!(ext[2 * c + 1] > ext[2 * c])) continue;
    const ra = Math.floor(ext[2 * c]), rb = Math.min(H - 1, Math.ceil(ext[2 * c + 1]) - 1);
    if (ra < r0) r0 = ra;
    if (rb > r1) r1 = rb;
    let accD = 0, accT = 0, k = c * H + ra, g = c * G + ra;
    if (touch) {
      for (let r = ra; r <= rb; r++, k++, g++) {
        accD += dD[g]; accT += dT[g]; dD[g] = 0; dT[g] = 0;
        D[k] += accD; touch[k] += accT;
      }
    } else {
      for (let r = ra; r <= rb; r++, k++, g++) { accD += dD[g]; dD[g] = 0; dT[g] = 0; D[k] += accD; }
    }
    dD[g] = 0; dT[g] = 0;                              // (the row after: the pieces' last subtractions)
  }
  return [r0, r1];
}

/**
 * The picture of a deposit: out[r W + c] (row by row, as ImageData is) = rgb | alpha << 24, rgb
 * the colour (0xBBGGRR) and alpha its brightness, from D and touch (column by column, as
 * depositTrace leaves them) and ext.  First D is filtered across columns by (1, 2, 1)/4, which
 * takes out what the tent leaves of a trace two pixels per cycle, by a weight w: smooth true, 1;
 * false, 0; 'auto' (with rev, depositTrace's turning points), from the turns per column around
 * each column, 0 at 0.4 or fewer (five or more pixels a cycle: the cycles stand apart and are
 * drawn sharp) to 1 at 0.9 or more (about two pixels a cycle or fewer: a band).  Then each
 * pixel's relative density, D times its column's height of trace (S, widened toward the
 * neighbours' as it is smoothed), gives min(1, gain D S)^gamma, raised to floor times touch (at
 * most 1) where the trace only passed.  thick: half the trace's thickness beyond one pixel, put on
 * as a spread down each column (a pixel's time shared over the rows a line that thick covers), so
 * the pieces of a thick trace don't overlap at its corners as thickening each piece would.  A: the brightest alpha (255 for opaque).  Writes only the
 * pixels of the columns' touched rows (out must be clear elsewhere) and clears D and touch there.
 * Pure; lut: powLut(gamma).
 */
export function shadeTrace(D, touch, W, H, ext, out, rgb, { gain = 1, floor = 0.35, smooth = true, rev = null, thick = 0, A = 255, lut = powLut(0.7) } = {}) {
  const LN = lut.length - 1, fl = floor * A, auto = smooth === 'auto' && rev;
  const K = thickKernel(thick), J = (K.length - 1) / 2, tk = 1 + 2 * thick;
  const fixedW = smooth === true || (smooth === 'auto' && !rev) ? 1 : 0;
  let pl = Infinity, ph = -Infinity;                   // the previous column's own extent
  for (let c = 0; c < W; c++) {
    const l = ext[2 * c], h = ext[2 * c + 1];
    const nl = c + 1 < W ? ext[2 * c + 2] : Infinity, nh = c + 1 < W ? ext[2 * c + 3] : -Infinity;
    const ul = Math.min(pl, l, nl), uh = Math.max(ph, h, nh);
    pl = l; ph = h;
    let w = fixedW;
    if (auto) {
      const turns = ((c > 0 ? rev[c - 1] : rev[c]) + rev[c] + (c + 1 < W ? rev[c + 1] : rev[c])) / 3;
      w = turns <= 0.4 ? 0 : turns >= 0.9 ? 1 : (turns - 0.4) / 0.5;
    }
    const own = h > l;
    if (!own && !(w > 0 && uh > ul)) continue;
    const span = !own ? uh - ul : w > 0 ? (h - l) + w * ((uh - ul) - (h - l)) : h - l;
    const S = gain * LN * Math.max(1, span + 2 * thick);
    const lo = w > 0 ? ul : l, hi = w > 0 ? uh : h;
    const ra = Math.max(0, Math.floor(lo) - J), rb = Math.min(H - 1, Math.ceil(hi) - 1 + J);
    const k = c * H, kl = c > 0 ? k - H : k, kr = c + 1 < W ? k + H : k, w4 = 0.25 * w, w2 = 1 - 0.5 * w;
    for (let r = ra; r <= rb; r++) {
      let d, t = 0;
      if (J === 0) {
        d = w > 0 ? w2 * D[k + r] + w4 * (D[kl + r] + D[kr + r]) : D[k + r];
        if (touch) t = touch[k + r];
      } else {                                         // a thick trace: each row spread over the rows its thickness covers
        d = 0;
        for (let j = -J; j <= J; j++) {
          const rr = r - j;
          if (rr < 0 || rr >= H) continue;
          const kj = K[j + J];
          d += kj * (w > 0 ? w2 * D[k + rr] + w4 * (D[kl + rr] + D[kr + rr]) : D[k + rr]);
          if (touch) t += kj * touch[k + rr];
        }
        t *= tk;
      }
      if (!(d > 0)) continue;
      const rel = d * S, g = A * lut[rel < LN ? rel | 0 : LN], f = t < 1 ? fl * t : fl;
      out[r * W + c] = (rgb | ((g > f ? g : f) << 24)) >>> 0;
    }
  }
  for (let c = 0; c < W; c++) {                       // clear what was used, for the next trace
    if (!(ext[2 * c + 1] > ext[2 * c])) continue;
    const ra = Math.floor(ext[2 * c]), rb = Math.min(H - 1, Math.ceil(ext[2 * c + 1]) - 1), k = c * H;
    D.fill(0, k + ra, k + rb + 1);
    if (touch) touch.fill(0, k + ra, k + rb + 1);
  }
}

const kernels = new Map();
/** The share of a row's time in each row from -J to J of a trace thickened by h on each side. */
function thickKernel(h) {
  h = Math.round(h * 1000) / 1000;
  let K = kernels.get(h);
  if (K) return K;
  if (!(h > 0)) K = new Float64Array([1]);
  else {
    const J = Math.ceil(h), n = 64;
    K = new Float64Array(2 * J + 1);
    for (let j = -J; j <= J; j++) {                  // ∫₀¹ overlap([y − h, y + h], [j, j + 1]) / 2h dy
      let a = 0;
      for (let q = 0; q < n; q++) { const y = (q + 0.5) / n; a += Math.max(0, Math.min(y + h, j + 1) - Math.max(y - h, j)); }
      K[j + J] = a / n / (2 * h);
    }
    let sum = 0; for (const v of K) sum += v;
    for (let j = 0; j < K.length; j++) K[j] /= sum;
  }
  kernels.set(h, K);
  return K;
}

// Scratch shared by every trace: grown, never shrunk.  D and T are left zeroed after each use.
const cache = { cap: 0, D: null, T: null, work: null, ext: null, rev: null, X: null, Y: null, canvas: null, cctx: null, imgs: new Map() };
function scratch(W, H, n) {
  if (W * (H + 1) > cache.cap) {
    cache.cap = W * (H + 1);
    cache.D = new Float32Array(cache.cap); cache.T = new Float32Array(cache.cap);
    cache.work = { dD: new Float32Array(cache.cap), dT: new Float32Array(cache.cap) };
  }
  if (!cache.ext || cache.ext.length < 2 * W) { cache.ext = new Float64Array(2 * W); cache.rev = new Float32Array(W); }
  if (!cache.X || cache.X.length < n) { cache.X = new Float64Array(n); cache.Y = new Float64Array(n); }
  if (!cache.canvas) { cache.canvas = document.createElement('canvas'); cache.cctx = cache.canvas.getContext('2d'); }
  if (cache.canvas.width < W || cache.canvas.height < H) {
    cache.canvas.width = Math.max(W, cache.canvas.width); cache.canvas.height = Math.max(H, cache.canvas.height);
  }
  const key = `${W}x${H}`;
  let img = cache.imgs.get(key);
  if (!img) {
    if (cache.imgs.size > 8) cache.imgs.clear();
    const id = cache.cctx.createImageData(W, H);
    img = { id, px: new Uint32Array(id.data.buffer) };
    cache.imgs.set(key, img);
  }
  return img;
}
const luts = new Map();
/** pow(i / 4096, gamma) for i = 0..4096. */
export function powLut(gamma) {
  let t = luts.get(gamma);
  if (!t) { t = new Float32Array(4097); for (let i = 0; i <= 4096; i++) t[i] = Math.pow(i / 4096, gamma); luts.set(gamma, t); }
  return t;
}

const rgbCache = new Map();
function rgbOf(color) {
  let v = rgbCache.get(color);
  if (v) return v;
  const c = document.createElement('canvas'); c.width = c.height = 1;
  const x = c.getContext('2d'); x.fillStyle = '#000'; x.fillStyle = color; x.fillRect(0, 0, 1, 1);
  const d = x.getImageData(0, 0, 1, 1).data;
  v = [d[0] | (d[1] << 8) | (d[2] << 16), d[3] / 255];
  rgbCache.set(color, v);
  return v;
}

/**
 * Draw a trace of n samples into the region {left, top, w, h} (a Frame will do), in the
 * context's drawing coordinates (any scale and offset; no rotation).  opts:
 *   n; y: (i) => drawing y, or an array of them;
 *   x0, x1: the drawing x of samples 0 and n - 1 (evenly spaced), or x: (i) => drawing x;
 *   color (CSS), width (drawing px, default 1), alpha (default 1);
 *   gain (default 1), gamma (default 0.7): brightness from density; floor (default 0.35): the
 *     least brightness of a pixel the trace crosses, however fast (raise it where a brief spike
 *     is the point of the plot);
 *   smooth: filter across columns (true), or not (false); left out, only where the trace turns
 *     about once a column or more (a band, which would otherwise beat against the pixel grid),
 *     not where its cycles stand apart (which smoothing would run together);
 *   bandlimited: interpolate a sparse trace as a band-limited signal (default false);
 *   mode: 'graded' or 'fast', to override scopeMode() for this trace;
 *   key: a string naming everything the samples depend on (say the source and the distance):
 *     while it, the region, the transform and the look are unchanged, the last picture is copied
 *     instead of drawn again.  Leave it out for a trace whose samples change from frame to frame.
 * Returns the time the drawing took, in ms.
 */
export function scopeTrace(ctx, region, o) {
  const t0 = performance.now();
  const n = o.n | 0;
  if (n < 2) return 0;
  const M = ctx.getTransform(), sx = M.a, sy = M.d, ex = M.e, ey = M.f;
  const L = Math.floor(ex + sx * region.left), Tp = Math.floor(ey + sy * region.top);
  const W = Math.max(1, Math.ceil(ex + sx * (region.left + region.w)) - L);
  const H = Math.max(1, Math.ceil(ey + sy * (region.top + region.h)) - Tp);
  const mode = o.mode || MODE;
  const color = o.color || '#000', width = o.width ?? 1;
  let memo = null;
  if (o.key != null && mode !== 'fast') {
    const full = [o.key, L, Tp, W, H, sx, sy, color, width, o.alpha, o.gain, o.gamma, o.floor, o.smooth, o.bandlimited].join('|');
    memo = memos.get(o.key);
    if (memo) { memos.delete(o.key); memos.set(o.key, memo); }    // (the most recently used last)
    if (memo && memo.full === full) {
      if (memo.rows > 0) drawRows(ctx, memo.canvas, 0, memo.rows, L, Tp + memo.q0, W);
      return performance.now() - t0;
    }
    if (!memo) {
      memo = { canvas: document.createElement('canvas'), px: 0 };
      memos.set(o.key, memo);
    }
    memo.full = full; memo.rows = 0;
  }
  const img = scratch(W, H, n);
  let X = cache.X, Y = cache.Y;
  const ox = ex - L, oy = ey - Tp, yv = o.y;
  if (o.x) for (let i = 0; i < n; i++) X[i] = ox + sx * o.x(i);
  else { const a = ox + sx * o.x0, b = (sx * (o.x1 - o.x0)) / (n - 1); for (let i = 0; i < n; i++) X[i] = a + b * i; }
  if (typeof yv === 'function') for (let i = 0; i < n; i++) Y[i] = oy + sy * yv(i);
  else for (let i = 0; i < n; i++) Y[i] = oy + sy * yv[i];
  if (mode === 'fast') { drawFast(ctx, X, Y, n, W, L, Tp, color, width * sx, o.alpha ?? 1); return performance.now() - t0; }
  let N = n;
  if (o.bandlimited) {
    const spc = n / Math.max(1, Math.abs(X[n - 1] - X[0]));      // samples per device column
    if (spc < 2) {
      const k = Math.min(16, Math.ceil(2 / spc));
      Y = upsample(Y, n, k);
      const Xu = new Float64Array(Y.length);
      for (let j = 0; j < Y.length; j++) { const i = Math.min(n - 2, Math.floor(j / k)), f = j / k - i; Xu[j] = X[i] + (X[i + 1] - X[i]) * f; }
      X = Xu; N = Y.length;
    }
  }
  if (N < 1.5 * Math.abs(X[N - 1] - X[0])) {         // a line, not a band: the canvas's own line will do
    if (memo) memos.delete(o.key);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.beginPath(); ctx.rect(L, Tp, W, H); ctx.clip();
    ctx.strokeStyle = color; ctx.lineWidth = width * sx; ctx.globalAlpha *= o.alpha ?? 1; ctx.lineJoin = 'round';
    ctx.beginPath();
    let pen = false;
    for (let i = 0; i < N; i++) {
      if (!Number.isFinite(Y[i]) || !Number.isFinite(X[i])) { pen = false; continue; }
      if (pen) ctx.lineTo(L + X[i], Tp + Y[i]); else { ctx.moveTo(L + X[i], Tp + Y[i]); pen = true; }
    }
    ctx.stroke();
    ctx.restore();
    return performance.now() - t0;
  }
  const ext = cache.ext;
  // Thickness: up to two device pixels, each piece widened (cheap, and its overlaps at the corners
  // too small to see); thicker, spread down the columns after (no beads where the pieces meet).
  const half = Math.max(0, (width * sy - 1) / 2), thick = half > 0.5 ? half : 0;
  let [r0, r1] = depositTrace(cache.D, W, H, X, Y, N, thick ? 0 : half, ext, cache.T, cache.work, cache.rev);
  if (r1 < r0) return performance.now() - t0;
  // (Smoothing widens a column's rows to its neighbours', which are within r0..r1 too.)
  const q0 = Math.max(0, r0 - Math.ceil(thick)), q1 = Math.min(H - 1, r1 + Math.ceil(thick));
  img.px.fill(0, q0 * W, (q1 + 1) * W);
  const [rgb, ca] = rgbOf(color);
  shadeTrace(cache.D, cache.T, W, H, ext, img.px, rgb, { gain: o.gain ?? 1, floor: o.floor ?? 0.35, smooth: typeof o.smooth === 'boolean' ? o.smooth : 'auto', rev: cache.rev, thick, A: 255 * ca * (o.alpha ?? 1), lut: powLut(o.gamma ?? 0.7) });
  const cctx = cache.cctx, rows = q1 - q0 + 1;
  cctx.putImageData(img.id, 0, 0, 0, q0, W, rows);    // (replaces those pixels: no clearing needed)
  drawRows(ctx, cache.canvas, q0, rows, L, Tp + q0, W);
  if (memo) {
    if (memo.canvas.width !== W || memo.canvas.height !== rows) { memo.canvas.width = W; memo.canvas.height = rows; }
    const m = memo.canvas.getContext('2d');
    m.globalCompositeOperation = 'copy';
    m.drawImage(cache.canvas, 0, q0, W, rows, 0, 0, W, rows);
    memo.q0 = q0; memo.rows = rows; memo.px = W * rows;
    trimMemos(o.key);
  }
  return performance.now() - t0;
}

// The pictures kept for keyed traces: at most 12, and at most 4 million pixels (16 MB) together,
// the least recently used given up first (a demo that makes a new key each pass keeps only a few).
const memos = new Map();
function trimMemos(keep) {
  let total = 0;
  for (const m of memos.values()) total += m.px || 0;
  for (const [k, m] of memos) {
    if (memos.size <= 1 || (memos.size <= 12 && total <= 4e6)) break;
    if (k === keep) continue;
    total -= m.px || 0; m.canvas.width = m.canvas.height = 0; memos.delete(k);
  }
}
/** Rows sy.. (rows of them, W wide) of a picture onto the context at device pixel (dx, dy). */
function drawRows(ctx, canvas, sy, rows, dx, dy, W) {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(canvas, 0, sy, W, rows, dx, dy, W, rows);
  ctx.restore();
}

/** The old way: per device column the samples' lowest to highest, a solid line, joined up (but
 *  not across a gap: a sample that is not a number, as in the other two ways). */
function drawFast(ctx, X, Y, n, W, L, Tp, color, lw, alpha) {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.strokeStyle = color; ctx.lineWidth = Math.max(1, lw); ctx.globalAlpha *= alpha;
  // (Round joins: the path turns sharply at every column of a band, and the default miter joins
  // stick out of it as spikes wherever the turns are not quite sharp enough to be bevelled.)
  ctx.lineJoin = 'round';
  ctx.beginPath();
  let i = 0, started = false;
  for (let c = 0; c < W && i < n; c++) {
    let lo = Infinity, hi = -Infinity, gap = false;
    while (i < n && X[i] < c + 1) {
      if (X[i] >= c) { const y = Y[i]; if (Number.isFinite(y)) { if (y < lo) lo = y; if (y > hi) hi = y; } else gap = true; }
      i++;
    }
    if (lo === Infinity) { if (gap) started = false; continue; }
    const x = L + c + 0.5;
    if (!started || gap) ctx.moveTo(x, Tp + lo);
    started = !gap;
    ctx.lineTo(x, Tp + lo); ctx.lineTo(x, Tp + hi);
  }
  ctx.stroke();
  ctx.restore();
}
