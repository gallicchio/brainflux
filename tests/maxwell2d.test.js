import { test, assert, close } from './harness.js';
import { Yee2D, PointSource, BeamSource, MovingSource, Probe, FluxLine, FlowField, OMEGA, numericalK } from '../maxwell2d/fdtd.js';
import { Scene, SHAPES } from '../maxwell2d/scene.js';
import { reflectance, snell, layerTransmission, cavityFrequency, cavityFrequencyYee, cherenkovAngle, ringdown, fresnelR, brewsterAngle, beamAverage } from '../maxwell2d/theory.js';

const deg = Math.PI / 180;

function simOf(scene, mode = 'TM', opts = {}) {
  const sim = new Yee2D({ nx: scene.nx, ny: scene.ny, dx: scene.dx, pml: scene.pml, x0: scene.x0, y0: scene.y0, mode, ...opts });
  scene.applyTo(sim);
  return sim;
}

/** |Fourier component at the source frequency| of a sampled signal. */
function atF1(t, v) {
  let re = 0, im = 0;
  for (let q = 0; q < t.length; q++) { re += v[q] * Math.cos(OMEGA * t[q]); im -= v[q] * Math.sin(OMEGA * t[q]); }
  return Math.hypot(re, im);
}

// ------------------------------------------------------------------ the scheme itself

test('a closed box conserves the Yee energy exactly (TM and TE, with glass and metal inside)', () => {
  const notes = [];
  for (const mode of ['TM', 'TE']) {
    const scene = new Scene({ W: 3, H: 2, ppw: 20, pml: 0 });
    scene.setShapes([{ k: 'disk', x: 0.4, y: 0.1, r: 0.35, mat: { n: 2 } }, { k: 'rect', x0: -0.9, x1: -0.6, y0: -0.5, y1: 0.4, mat: { pec: true } }]);
    const sim = simOf(scene, mode, { pml: 0 });
    for (let j = 0; j < sim.ny; j++) for (let i = 0; i < sim.nx; i++) {
      const x = sim.nodeX(i) + 0.2, y = sim.nodeY(j);
      if (sim.Ku[j * sim.nx + i] > 0) sim.u[j * sim.nx + i] = Math.exp(-(x * x + y * y) / 0.05);
    }
    const W = [];
    for (let s = 0; s < 3000; s++) {
      const u0 = sim.u.slice(), a0 = sim.a.slice(), b0 = sim.b.slice();
      sim.step();
      if (s % 100 === 0) W.push(sim.energy(u0, a0, b0));
    }
    const spread = (Math.max(...W) - Math.min(...W)) / W[0];
    assert(spread < 1e-11, `${mode}: energy varies by ${spread}`);
    notes.push(`${mode} ${spread.toExponential(1)}`);
  }
  return `relative change over 3000 steps: ${notes.join(', ')}`;
});

test('rectangular metal cavity: TM mode frequencies are the Yee ones exactly, and converge to pi sqrt((m/a)^2+(n/b)^2) as dx^2', () => {
  const out = [];
  const errs = {};
  for (const res of [20, 40]) {
    const M = res, N = Math.round(0.75 * res), dx = 1 / res, a = M * dx, b = N * dx;
    for (const [m, n] of [[1, 1], [2, 1], [1, 3]]) {
      const sim = new Yee2D({ nx: M + 1, ny: N + 1, dx, pml: 0 });
      for (let j = 0; j <= N; j++) for (let i = 0; i <= M; i++) {
        const k = j * (M + 1) + i;
        if (i === 0 || j === 0 || i === M || j === N) { sim.Cu[k] = 0; sim.Ku[k] = 0; }
        else sim.u[k] = Math.sin((m * Math.PI * i) / M) * Math.sin((n * Math.PI * j) / N);
      }
      const probe = (Math.round(N / 7) + 1) * (M + 1) + Math.round(M / 5) + 1;
      let prev = sim.u[probe], first = null, last = null, count = 0;
      while (count < 120) {
        sim.step();
        const v = sim.u[probe];
        if ((prev < 0) !== (v < 0)) {
          const tc = sim.t - sim.dt + (sim.dt * prev) / (prev - v);
          if (first === null) first = tc; else { last = tc; count++; }
        }
        prev = v;
      }
      const f = count / (2 * (last - first));
      const fYee = cavityFrequencyYee(a, b, m, n, dx, sim.dt), fc = cavityFrequency(a, b, m, n);
      assert(Math.abs(f / fYee - 1) < 1e-5, `TM${m}${n} at ${res}/λ: measured ${f}, Yee ${fYee}`);
      errs[`${m}${n}-${res}`] = f / fc - 1;
      if (res === 40) out.push(`TM${m}${n}: ${f.toFixed(6)} (Yee ${fYee.toFixed(6)}, exact ${fc.toFixed(6)})`);
    }
  }
  for (const mn of ['11', '21', '13']) {
    const ratio = errs[`${mn}-20`] / errs[`${mn}-40`];
    assert(ratio > 3.8 && ratio < 4.2, `TM${mn}: error ratio ${ratio} on halving dx`);
  }
  return out.join('; ');
});

test('the energy-free averaging: the time average of u^2 for a CW wave is A^2/2 with no ripple', () => {
  const scene = new Scene({ W: 8, H: 0.4, ppw: 20, pml: 16 });
  scene.setShapes([]);
  const sim = simOf(scene, 'TM', { periodicY: true });
  sim.sources.push(new BeamSource({ x: -2, y: 0, angle: 0, width: 1e6, wave: 'cw' }));
  sim.trackIntensity(true, 1);
  const k = (sim.ny >> 1) * sim.nx + Math.round((1 - sim.x0) / sim.dx);
  sim.run(sim.stepsPerPeriod * 14);
  const vals = [];
  for (let s = 0; s < sim.stepsPerPeriod; s++) { sim.step(); vals.push(sim.intensity[k]); }
  const lo = Math.min(...vals), hi = Math.max(...vals);
  close(lo, 0.5, 0.005, 'mean of u^2');
  assert(hi - lo < 1e-3, `ripple ${hi - lo}`);
  return `<u²> = ${lo.toFixed(5)}..${hi.toFixed(5)} (A = 1)`;
});

// ------------------------------------------------------------------ the absorbing layer and the sources

test('the PML reflects < 1% at normal incidence (a pulse, TM and TE), and the source line leaks less', () => {
  const notes = [];
  for (const mode of ['TM', 'TE']) {
    const scene = new Scene({ W: 12, H: 0.4, ppw: 20, pml: 16 });
    scene.setShapes([]);
    const sim = simOf(scene, mode, { periodicY: true });
    sim.sources.push(new BeamSource({ x: -3, y: 0, angle: 0, width: 1e6, wave: 'pulse' }));
    const back = new Probe({ x: -4.5, y: 0 }), fwd = new Probe({ x: 2, y: 0 });
    sim.monitors.push(back, fwd);
    sim.run(Math.round(30 / sim.dt));
    const inc = Math.max(...fwd.last().v.map(Math.abs));
    const { t, v } = back.last();
    // Leakage arrives at once; the reflection off the far layer (at x = 6) after 9 + 10.5 periods.
    let leak = 0, refl = 0;
    for (let q = 0; q < t.length; q++) { if (t[q] < 12) leak = Math.max(leak, Math.abs(v[q])); else refl = Math.max(refl, Math.abs(v[q])); }
    assert(refl / inc < 0.01, `${mode}: reflection ${refl / inc}`);
    assert(leak / inc < 0.01, `${mode}: leakage ${leak / inc}`);
    notes.push(`${mode}: reflected ${(refl / inc).toExponential(1)}, leaked ${(leak / inc).toExponential(1)}`);
  }
  return notes.join('; ');
});

test('the PML in 2D: a pulse from a point in a small box matches the same pulse in a big one to < 1%', () => {
  const run = (L) => {
    const scene = new Scene({ W: L, H: L, ppw: 20, pml: 16 });
    scene.setShapes([]);
    const sim = simOf(scene);
    sim.sources.push(new PointSource({ x: 0, y: 0, wave: 'pulse' }));
    const probes = [[1.7, 0.2], [1.6, 1.6], [-0.5, -1.8]].map(([x, y]) => new Probe({ x, y }));
    sim.monitors.push(...probes);
    sim.run(Math.round(12 / sim.dt));
    return probes.map((p) => p.last().v);
  };
  const small = run(4), big = run(14);
  let worst = 0, peak = 0;
  small.forEach((v, p) => v.forEach((x, q) => { worst = Math.max(worst, Math.abs(x - big[p][q])); peak = Math.max(peak, Math.abs(big[p][q])); }));
  assert(worst / peak < 0.01, `difference ${worst / peak}`);
  return `largest difference ${(100 * worst / peak).toFixed(3)}% of the peak, 0.2-0.4 λ from the layer`;
});

test('the beam source carries the power of its Gaussian (as the grid measures it), and leaks little behind its line', () => {
  const notes = [];
  for (const [mode, angle, n] of [['TM', 0, 1], ['TM', 25 * deg, 1], ['TE', -35 * deg, 1], ['TE', 60 * deg, 1], ['TM', 30 * deg, 1.5], ['TE', 30 * deg, 1.5]]) {
    const scene = new Scene({ W: 12, H: 12, ppw: 20 * n, pml: 16 });
    scene.setShapes(n > 1 ? SHAPES.fill.build(0, n, scene.W, scene.H) : []);
    const sim = simOf(scene, mode);
    const beam = new BeamSource({ x: -2, y: 0, angle, width: 1.5, wave: 'cw', n });
    sim.sources.push(beam);
    // Across the beam, 3 wavelengths on.
    const c0 = Math.cos(angle), s0 = Math.sin(angle), xm = -2 + 3 * c0, ym = 3 * s0;
    const meter = new FluxLine({ x0: xm + 4.2 * s0, y0: ym - 4.2 * c0, x1: xm - 4.2 * s0, y1: ym + 4.2 * c0 });
    sim.monitors.push(meter);
    sim.run(sim.stepsPerPeriod * 16);
    const P = meter.power / beam.power(mode);
    // Behind the line only leakage.
    let leak = 0, front = 0;
    const c = Math.cos(angle), s = Math.sin(angle);
    for (let j = scene.pml; j < sim.ny - scene.pml; j++) for (let i = scene.pml; i < sim.nx - scene.pml; i++) {
      const x = sim.nodeX(i) + 2, y = sim.nodeY(j), v = Math.abs(sim.u[j * sim.nx + i]);
      const along = x * c + y * s, perp = -x * s + y * c;
      if (along < -0.3 && Math.abs(perp) < 4.8) leak = Math.max(leak, v); else if (along > 0.5) front = Math.max(front, v);
    }
    close(P, 1, 0.01, `${mode} at ${angle / deg}°: power`);
    assert(leak / front < 0.01, `${mode} at ${angle / deg}°: leak ${leak / front}`);
    notes.push(`${mode} ${Math.round(angle / deg)}°${n > 1 ? ' in n = ' + n : ''}: P/P_Gauss = ${P.toFixed(4)}, leak ${(leak / front).toExponential(1)}`);
  }
  return notes.join('; ');
});

// ------------------------------------------------------------------ optics

test('Fresnel at normal incidence: r = (1-n)/(1+n), t = 2/(1+n) for E (TM), 2n/(1+n) for H (TE)', () => {
  const notes = [];
  for (const mode of ['TM', 'TE']) for (const n of [1.5, 3.5]) {
    const ppw = Math.round(20 * n);
    const run = (glass) => {
      const scene = new Scene({ W: 10, H: 0.2, ppw, pml: 16 });
      scene.setShapes(glass ? [{ k: 'rect', x0: 0, x1: 99, y0: -99, y1: 99, mat: { n } }] : []);
      const sim = simOf(scene, mode, { periodicY: true });
      sim.sources.push(new BeamSource({ x: -3, y: 0, angle: 0, width: 1e6, wave: 'pulse' }));
      const back = new Probe({ x: -4, y: 0 }), inside = new Probe({ x: 1.5, y: 0 });
      sim.monitors.push(back, inside);
      sim.run(Math.round(16 / sim.dt));
      return [back.last(), inside.last()];
    };
    const inc = run(false)[1];
    const [refl, trans] = run(true);
    const r = atF1(refl.t, refl.v) / atF1(inc.t, inc.v), t = atF1(trans.t, trans.v) / atF1(inc.t, inc.v);
    const rWant = (n - 1) / (n + 1), tWant = mode === 'TM' ? 2 / (1 + n) : (2 * n) / (1 + n);
    close(r, rWant, 0.004, `${mode} n=${n}: |r|`);
    close(t, tWant, 0.01, `${mode} n=${n}: |t|`);
    notes.push(`${mode} n=${n}: |r| ${r.toFixed(4)} (${rWant.toFixed(4)}), |t| ${t.toFixed(4)} (${tWant.toFixed(4)})`);
  }
  return notes.join('; ');
});

test('a quarter-wave slab reflects ((n^2-1)/(n^2+1))^2, a half-wave slab nothing', () => {
  const n = 1.5, ppw = 48, notes = [];
  const run = (d) => {
    const scene = new Scene({ W: 10, H: 0.2, ppw, pml: 16 });
    scene.setShapes(d ? [{ k: 'rect', x0: 0, x1: d, y0: -99, y1: 99, mat: { n } }] : []);
    const sim = simOf(scene, 'TM', { periodicY: true });
    sim.sources.push(new BeamSource({ x: -3, y: 0, angle: 0, width: 1e6, wave: 'pulse' }));
    const back = new Probe({ x: -4, y: 0 });
    sim.monitors.push(back);
    sim.run(Math.round(22 / sim.dt));
    return back.last();
  };
  const inc = (() => {
    const scene = new Scene({ W: 10, H: 0.2, ppw, pml: 16 });
    scene.setShapes([]);
    const sim = simOf(scene, 'TM', { periodicY: true });
    sim.sources.push(new BeamSource({ x: -3, y: 0, angle: 0, width: 1e6, wave: 'pulse' }));
    const p = new Probe({ x: -1, y: 0 });
    sim.monitors.push(p);
    sim.run(Math.round(22 / sim.dt));
    return p.last();
  })();
  const I = atF1(inc.t, inc.v);
  const Rq = (atF1(...Object.values(run(1 / (4 * n)))) / I) ** 2, Rh = (atF1(...Object.values(run(1 / (2 * n)))) / I) ** 2;
  const want = ((n * n - 1) / (n * n + 1)) ** 2;
  close(Rq, want, 0.003, 'quarter wave');
  assert(Rh < 1e-3, `half wave ${Rh}`);
  return `quarter wave R = ${Rq.toFixed(4)} (theory ${want.toFixed(4)}), half wave R = ${Rh.toExponential(1)}`;
});

/**
 * A Gaussian beam aimed at the origin, where glass filling y < 0 (or another shape) meets
 * vacuum; from above, or from inside the glass.  The beam starts far enough away that its
 * source line lies wholly in its own medium, and the box is made big enough to hold it.
 */
function surfaceRun({ mode = 'TM', n = 1.5, theta, fromGlass = false, width = 1.2, ppw = 30, periods = 20, shapes = null, lines = [], extra = 0 }) {
  const d = Math.max(3, 2.6 * width * Math.tan(theta) + 0.5);
  const W = 2 * (d * Math.sin(theta) + 2.6 * width * Math.cos(theta) + 1) + extra;
  const H = 2 * (d * Math.cos(theta) + 2.6 * width * Math.sin(theta) + 0.6) + extra;
  const scene = new Scene({ W, H, ppw, pml: 16 });
  scene.setShapes(shapes ? shapes(scene) : SHAPES.surface.build(0, n, scene.W, scene.H));
  const sim = simOf(scene, mode);
  const dir = fromGlass ? Math.PI / 2 - theta : -Math.PI / 2 + theta;
  const x = -d * Math.cos(dir), y = -d * Math.sin(dir), n1 = scene.materialAt(x, y).n;
  const beam = new BeamSource({ x, y, angle: dir, width, wave: 'cw', n: n1 });
  sim.sources.push(beam);
  const meters = lines.map((l) => new FluxLine(typeof l === 'function' ? l(scene) : l));
  sim.monitors.push(...meters);
  sim.run(sim.stepsPerPeriod * periods);
  return { sim, scene, beam, meters, P: beam.power(mode), n1 };
}
/** A horizontal line across the box at height y, its normal pointing up (or down). */
const across = (y, up = true) => (scene) => (up ? { x0: scene.W / 2 - 0.2, y0: y, x1: -scene.W / 2 + 0.2, y1: y } : { x0: -scene.W / 2 + 0.2, y0: y, x1: scene.W / 2 - 0.2, y1: y });

test("Snell's law: the energy in the glass flows at asin(sin(theta)/n)", () => {
  const notes = [];
  for (const theta of [30 * deg, 55 * deg]) {
    const { sim } = surfaceRun({ theta, width: 1.6, periods: 18 });
    // The Poynting vector, averaged over about a period, summed over a region inside the glass.
    const nodes = [];
    for (let j = 0; j < sim.ny; j++) for (let i = 0; i < sim.nx; i++) {
      const x = sim.nodeX(i), y = sim.nodeY(j);
      if (y > -3.2 && y < -0.8 && Math.abs(x) < 6) nodes.push(j * sim.nx + i);
    }
    const flow = new FlowField(nodes);
    sim.monitors.push(flow);
    sim.run(sim.stepsPerPeriod * 4);
    let sx = 0, sy = 0;
    for (let m = 0; m < nodes.length; m++) { sx += flow.sx[m]; sy += flow.sy[m]; }
    // The beam is a spread of plane waves, each refracted by Snell's law and transmitted by
    // Fresnel's T: its flow in the glass is their average direction, weighted by power.
    const T = (t) => 1 - reflectance(1, 1.5, t, 'TM');
    const want = Math.atan2(beamAverage((t) => T(t) * Math.sin(snell(1, 1.5, t)), theta, 1, 1.6), beamAverage((t) => T(t) * Math.cos(snell(1, 1.5, t)), theta, 1, 1.6));
    const measured = Math.atan2(sx, -sy);
    close(measured / deg, want / deg, 0.15, `θ1 = ${theta / deg}°`);
    notes.push(`θ1 = ${Math.round(theta / deg)}°: θ2 = ${(measured / deg).toFixed(2)}° (for this beam ${(want / deg).toFixed(2)}°, a plane wave ${(snell(1, 1.5, theta) / deg).toFixed(2)}°)`);
  }
  return notes.join('; ');
});

test('oblique reflection: Fresnel s (TM) and p (TE), and nothing reflected at Brewster\'s angle in TE', () => {
  const notes = [];
  const thetaB = brewsterAngle(1, 1.5), w = 1.6;
  for (const [mode, theta] of [['TM', 45 * deg], ['TE', 45 * deg], ['TM', thetaB], ['TE', thetaB]]) {
    // The power through a line inside the glass is what was not reflected.
    // (A box with room to spare: a beam keeps widening, and its wings must not be lost to the edges.)
    const { meters, P } = surfaceRun({ mode, theta, width: w, periods: 20, extra: 4, lines: [across(-0.5, false)] });
    const R = 1 - meters[0].power / P;
    const want = beamAverage((t) => reflectance(1, 1.5, t, mode), theta, 1, w);
    // The interface on the grid reflects a few per cent more or less than a true one (an error
    // of order (k dx)^2: at normal incidence |r| is 1.6% off at 20 cells a wavelength in the glass).
    close(R, want, 0.002 + 0.03 * want, `${mode} at ${(theta / deg).toFixed(1)}°: R`);
    notes.push(`${mode} ${(theta / deg).toFixed(1)}°: R = ${R.toFixed(4)} (Fresnel, for this beam: ${want.toFixed(4)}; plane wave ${reflectance(1, 1.5, theta, mode).toFixed(4)})`);
  }
  return notes.join('; ');
});

test('total internal reflection: no power escapes; frustrated by a thin gap, it tunnels as the plane-wave formula says', () => {
  const notes = [];
  {
    const { meters, P } = surfaceRun({ theta: 60 * deg, fromGlass: true, periods: 16, lines: [across(0.8)] });
    const T = meters[0].power / P;
    assert(Math.abs(T) < 1e-3, `TIR leaks ${T}`);
    notes.push(`TIR at 60°: T = ${T.toExponential(1)}`);
  }
  const w = 1.6;
  for (const [mode, theta, g] of [['TM', 50 * deg, 0.2], ['TM', 50 * deg, 0.4], ['TE', 50 * deg, 0.2]]) {
    const { meters, P } = surfaceRun({ mode, theta, fromGlass: true, width: w, periods: 18,
      shapes: (scene) => SHAPES.gap.build(g, 1.5, scene.W, scene.H), lines: [across(g / 2 + 1)] });
    const T = meters[0].power / P, want = beamAverage((t) => layerTransmission(1.5, 1, g, t, mode), theta, 1.5, w);
    close(T / want, 1, 0.03, `${mode} gap ${g}: T`);
    notes.push(`${mode} gap ${g} λ at 50°: T = ${T.toFixed(4)} (for this beam ${want.toFixed(4)}; plane wave ${layerTransmission(1.5, 1, g, theta, mode).toFixed(4)})`);
  }
  return notes.join('; ');
});

test('Cherenkov: a source faster than c/n in glass trails a cone with cos(theta) = 1/(n beta); slower, none', () => {
  const n = 1.5, notes = [];
  for (const beta of [0.9, 0.8]) {
    const scene = new Scene({ W: 16, H: 9, ppw: 24 });
    scene.setShapes(SHAPES.fill.build(0, n, scene.W, scene.H));
    const sim = simOf(scene);
    // A source 0.2 wide: a smaller one radiates wavelengths short enough for the grid's
    // dispersion to matter (0.1 wide, the cone comes out half a degree too wide).
    const src = new MovingSource({ x: -7, y: 0, angle: 0, beta, wave: 'steady', size: 0.2 });
    sim.sources.push(src);
    sim.run(Math.round(12 / beta / sim.dt));
    const [xs] = src.position(sim.t);
    // Along lines behind the source, where is |Ez| largest?  The cone's half-angle alpha (to the
    // velocity) has sin(alpha) = 1/(n beta); the light goes out at theta = 90° - alpha.
    const pts = [];
    for (const d of [0.6, 1.0, 1.4, 1.8, 2.2]) {
      const i = Math.round((xs - d - sim.x0) / sim.dx - 0.5);
      let best = 0, yb = 0;
      for (let j = 0; j < sim.ny; j++) {
        const y = sim.nodeY(j);
        if (y < 0.3 || y > 4.2) continue;
        const v = Math.abs(sim.u[j * sim.nx + i]);
        if (v > best) { best = v; yb = y; }
      }
      pts.push([sim.nodeX(i), yb]);
    }
    let sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (const [x, y] of pts) { sx += x; sy += y; sxx += x * x; sxy += x * y; }
    const slope = (pts.length * sxy - sx * sy) / (pts.length * sxx - sx * sx);
    const alpha = Math.atan(-slope), theta = 90 - alpha / deg, want = cherenkovAngle(n, beta) / deg;
    close(theta, want, 0.5, `β = ${beta}: θ`);
    notes.push(`β = ${beta}: θ = ${theta.toFixed(2)}° (theory ${want.toFixed(2)}°)`);
  }
  // Below threshold there is no cone: behind the source the field just falls off away from the
  // path (the moving source's own field), with no ridge.  Above it, |Ez| peaks on the cone.
  {
    const profile = (beta) => {
      const scene = new Scene({ W: 14, H: 8, ppw: 24 });
      scene.setShapes(SHAPES.fill.build(0, n, scene.W, scene.H));
      const sim = simOf(scene);
      const src = new MovingSource({ x: -6, y: 0, angle: 0, beta, wave: 'steady', size: 0.2 });
      sim.sources.push(src);
      sim.run(Math.round(9 / beta / sim.dt));
      const [xs] = src.position(sim.t);
      return [0.5, 1, 1.5, 2, 2.5, 3].map((y) => Math.abs(sim.sample(xs - 1.4, y)));
    };
    const slow = profile(0.6), fast = profile(0.9);
    assert(slow.every((v, q) => q === 0 || v < slow[q - 1]), `β = 0.6: |Ez| should fall away from the path: ${slow}`);
    const ridge = Math.max(...fast), peakAt = fast.indexOf(ridge);
    assert(peakAt > 0 && ridge > 10 * fast[0] && ridge > 5 * Math.max(...slow), `β = 0.9: a ridge on the cone: ${fast}`);
    notes.push(`|Ez| 1.4 λ behind, at y = 0.5..3: β = 0.6 [${slow.map((v) => v.toExponential(1)).join(' ')}], β = 0.9 [${fast.map((v) => v.toExponential(1)).join(' ')}]`);
  }
  return notes.join('; ');
});

// ------------------------------------------------------------------ analysis and materials

test('the painted Cavity shape rings at the Yee frequency of a 1/sqrt 2 wavelength box (metal placed to the cell)', () => {
  // At 41 cells a wavelength the walls fall on Ez nodes: the box is 29 cells, 0.7073 λ, inside.
  const scene = new Scene({ W: 4, H: 3, ppw: 41 });
  scene.setShapes(SHAPES.cavity.build(0, 1, scene.W, scene.H));
  const sim = simOf(scene);
  sim.sources.push(new PointSource({ x: 0, y: 0, wave: 'pulse' }));
  const p = new Probe({ x: 0.18, y: 0.18 });
  sim.monitors.push(p);
  sim.run(Math.round(60 / sim.dt));
  const { t, v } = p.last();
  const r = ringdown(t, v, { from: 10 });
  const want = cavityFrequencyYee(29 / 41, 29 / 41, 1, 1, sim.dx, sim.dt);
  close(r.f, want, 2e-4, 'f');
  assert(-r.slope < 1e-5, `a closed box does not lose energy (slope ${r.slope})`);
  return `f = ${r.f.toFixed(5)} (Yee ${want.toFixed(5)}; a continuous box of 1/√2 λ: 1)`;
});

test('the absorber: matched to vacuum, it reflects almost nothing and swallows what goes in', () => {
  const run = (shapes) => {
    const scene = new Scene({ W: 10, H: 0.2, ppw: 20 });
    scene.setShapes(shapes);
    const sim = simOf(scene, 'TM', { periodicY: true });
    sim.sources.push(new BeamSource({ x: -3, y: 0, angle: 0, width: 1e6, wave: 'pulse' }));
    const back = new Probe({ x: -4, y: 0 }), after = new Probe({ x: 2, y: 0 });
    sim.monitors.push(back, after);
    sim.run(Math.round(16 / sim.dt));
    return [back.last(), after.last()];
  };
  const [, inc] = run([]);
  const [refl, trans] = run([{ k: 'rect', x0: 0, x1: 1, y0: -9, y1: 9, mat: { absorb: true } }]);
  const R = (atF1(refl.t, refl.v) / atF1(inc.t, inc.v)) ** 2, T = (atF1(trans.t, trans.v) / atF1(inc.t, inc.v)) ** 2;
  assert(R < 1e-3, `reflects ${R}`);
  close(T, Math.exp(-2 * 6), 0.2 * Math.exp(-2 * 6), 'transmitted through 1 λ (e^-2σ)');
  return `R = ${R.toExponential(1)}, T through 1 λ = ${T.toExponential(2)} (e^{-12} = ${Math.exp(-12).toExponential(2)})`;
});

test('the ring-down fit recovers f and Q of a decaying oscillation', () => {
  const f = 1.07, tau = 25, dt = 1 / 40, t = [], v = [];
  for (let s = 0; s < 40 * 60; s++) { t.push(s * dt); v.push(Math.exp(-s * dt / tau) * Math.cos(2 * Math.PI * f * s * dt + 0.3)); }
  const r = ringdown(t, v);
  close(r.f, f, 1e-4, 'f');
  close(r.Q, Math.PI * f * tau, 0.002 * Math.PI * f * tau, 'Q');
  return `f = ${r.f.toFixed(5)}, Q = ${r.Q.toFixed(2)} (want ${(Math.PI * f * tau).toFixed(2)})`;
});

test('materials: partial cells get the mean of eps (arithmetic for E along the interface, harmonic across)', () => {
  const scene = new Scene({ W: 2, H: 1, ppw: 10, pml: 0 });
  scene.setShapes([{ k: 'rect', x0: 0, x1: 0.15, y0: -9, y1: 9, mat: { n: 1.5 } }]);
  const row = 5 * scene.nx, cell = (x) => row + Math.floor((x - scene.x0) / scene.dx);
  const m = scene.m;
  close(m.nodeEps[cell(0.05)], 2.25, 1e-12, 'full cell');
  close(m.nodeEps[cell(0.15)], 1.625, 1e-12, 'half cell (Ez, along)');
  close(m.aEps[cell(0.15)], 4 / (2 / 2.25 + 2), 1e-12, 'half cell (Ex, across)');
  // b at x = 0.2 sees [0.15, 0.25): vacuum; at x = 0.1 sees [0.05, 0.15): glass.
  close(m.bEps[cell(0.15)], 1, 1e-12, 'Ey at x = 0.2');
  close(m.bEps[cell(0.05)], 2.25, 1e-12, 'Ey at x = 0.1');
  // A slab 2.3 cells thick: the eps excess of the row is its thickness, to the 1/4-cell sampling.
  scene.setShapes([{ k: 'rect', x0: 0.03, x1: 0.26, y0: -9, y1: 9, mat: { n: 1.5 } }]);
  let excess = 0;
  for (let i = 0; i < scene.nx; i++) excess += m.nodeEps[row + i] - 1;
  close(excess / 1.25, 2.3, 0.25, 'thickness in cells');
  // Materials touching the edge carry on into the absorbing layer.
  const s2 = new Scene({ W: 2, H: 1, ppw: 10, pml: 4 });
  s2.setShapes([{ k: 'rect', x0: -9, x1: 9, y0: -9, y1: 0, mat: { n: 2 } }]);
  close(s2.m.nodeEps[1 * s2.nx + 1], 4, 1e-12, 'in the corner of the layer');
  close(s2.maxIndex(), 2, 1e-12, 'max index');
});

test('speed: cell updates per second (a 400 x 300 grid with its PML)', () => {
  const sim = new Yee2D({ nx: 432, ny: 332, dx: 1 / 20, pml: 16 });
  sim.sources.push(new PointSource({ x: 10, y: 8 }));
  sim.run(20);
  const t0 = performance.now();
  sim.run(200);
  const ms = performance.now() - t0, rate = (200 * 432 * 332) / (ms / 1000);
  return `${(rate / 1e6).toFixed(0)} M cell-steps/s: ${(ms / 200).toFixed(2)} ms a step for ${432 * 332} cells`;
});

void [numericalK, fresnelR];
