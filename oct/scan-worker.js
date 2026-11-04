// View 3's A-scans, computed off the page's thread (a module worker), so that scanning a volume
// or averaging sixteen B-scans never holds up the page's frames.  The page sends a job (the
// scene, the light, the beam, and which tasks: a B-scan's columns repeat by repeat, or a
// volume's A-scans row by row); the worker computes them in order, from task `from`, and posts
// them back in chunks of about 20 ms of work, each { id, from, to, data } with data the tasks'
// amplitudes, nz per task.  A new job replaces the old one at the next chunk.  The numbers are
// the same as the page's own (scan.js, the same seeds), which still computes them itself while
// its clock is held (the tests) or when no worker can be had.  A B-scan job first sends the
// speckle-free picture of every fourth column that has tissue in it ({ id, type: 'ref', cols,
// data }), what the page measures the speckle contrast against.

import { Source } from './source.js';
import { makeScene } from './sample.js';
import { BScan, Volume, column, sceneBeam, speckleRegion } from './scan.js';

let job = null;

self.onmessage = (e) => {
  const m = e.data;
  if (m.type === 'job') { job = start(m); schedule(job); }
  else if (m.type === 'stop') job = null;
};

function start(m) {
  const src = new Source(m.lam, m.fwhm), scene = makeScene(m.scene, m.sceneOpts), beam = sceneBeam(scene, src, m.NA, m.focus);
  const o = { ...m.opts, beam };
  let grid, total;
  if (m.kind === 'bscan') { grid = new BScan(scene, src, { nx: m.nx, nz: m.nz, y: m.y }); grid.setAverage(m.N, m.how, m.step); total = grid.tasks; }
  else { grid = new Volume(scene, src, { nx: m.nx, ny: m.ny, nz: m.nz }); total = m.nx * m.ny; }
  return { id: m.id, kind: m.kind, scene, src, beam, grid, o, t: m.from || 0, total, nz: m.nz, ref: !!m.ref };
}

function schedule(j) { setTimeout(() => work(j), 0); }

function work(j) {
  if (j !== job) return;
  const { grid, scene, src, nz } = j;
  if (j.ref) {
    // The speckle-free picture the contrast is measured against.
    const cols = [];
    for (let ix = 2; ix < grid.nx; ix += 4) if (speckleRegion(scene, grid.x(ix), grid.y, grid.hd, nz).length) cols.push(ix);
    const data = new Float32Array(cols.length * nz);
    cols.forEach((ix, i) => column(scene, src, grid.x(ix), grid.y, grid.hd, nz, data.subarray(i * nz, (i + 1) * nz), { beam: j.beam, speckle: false, quick: true }));
    self.postMessage({ id: j.id, type: 'ref', cols, data }, [data.buffer]);
    j.ref = false;
    schedule(j);
    return;
  }
  const t0 = performance.now(), from = j.t, max = 256;
  const data = new Float32Array(Math.min(max, j.total - from) * nz);
  while (j.t < j.total && j.t - from < max && (j.t === from || performance.now() - t0 < 20)) {
    const out = data.subarray((j.t - from) * nz, (j.t - from + 1) * nz);
    if (j.kind === 'bscan') { const k = grid.task(j.t, j.o); column(scene, src, k.x, k.y, grid.hd, nz, out, k.opts); }
    else { const iy = Math.floor(j.t / grid.nx), ix = j.t % grid.nx; column(scene, src, grid.x(ix), grid.y(iy), grid.hd, nz, out, j.o); }
    j.t++;
  }
  const part = data.slice(0, (j.t - from) * nz);
  self.postMessage({ id: j.id, type: 'tasks', from, to: j.t, data: part }, [part.buffer]);
  if (j.t < j.total) schedule(j);
}
