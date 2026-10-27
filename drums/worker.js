// The direct eigensolver, off the main thread so the drum keeps moving while it works.
// Message in:  { id, n, mask (Uint8Array), count, vectors }
// Messages out: { id, progress } ... then { id, values, vectors: Float32Array (vectors × N, by
//               mode), pts (the grid point of each component), dim, converged, ms }
import { domainOf, lowestModes } from './eigen.js';

self.onmessage = (e) => {
  const { id, n, mask, count, vectors } = e.data;
  const t0 = performance.now();
  try {
    const dom = domainOf(mask, n, 1 / (n - 1));
    let last = 0;
    const r = lowestModes(dom, {
      count, vectors,
      onProgress: (f) => { const now = performance.now(); if (now - last > 100) { last = now; self.postMessage({ id, progress: f }); } },
    });
    const V = new Float32Array(r.vectors.length * dom.N);
    r.vectors.forEach((v, k) => V.set(v, k * dom.N));
    self.postMessage({ id, values: r.values, vectors: V, nvec: r.vectors.length, pts: dom.pts, N: dom.N, dim: r.dim, converged: r.converged, ms: performance.now() - t0 },
      [r.values.buffer, V.buffer]);
  } catch (err) {
    self.postMessage({ id, error: String(err && err.message || err) });
  }
};
