import { test, assert } from './harness.js';
import { depositTrace, shadeTrace, powLut, upsample, scopeMode, setScopeMode } from '../lib/scope.js';

const near = (got, want, tol, what) => assert(Math.abs(got - want) <= tol, `${what}: expected ${want} ± ${tol}, got ${got}`);
const grid = (W, H) => new Float32Array(W * H);
// Deposits are column by column: pixel (column c, row r) is [c H + r].
const at = (D, H, c, r) => D[c * H + r];
const colSum = (D, W, H, c) => { let s = 0; for (let r = 0; r < H; r++) s += D[c * H + r]; return s; };

test('scope: a flat line through the middle of a row puts each column\'s whole time in that row', () => {
  const W = 20, H = 10, D = grid(W, H);
  depositTrace(D, W, H, [0, 20], [4.5, 4.5], 2);
  for (let c = 1; c < W - 1; c++) {
    near(at(D, H, c, 4), 1, 1e-9, `column ${c}, row 4`);
    near(colSum(D, W, H, c), 1, 1e-9, `column ${c}'s sum`);
  }
});

test('scope: a line on a row boundary is shared half and half (anti-aliased)', () => {
  const W = 10, H = 10, D = grid(W, H);
  depositTrace(D, W, H, [0, 10], [5, 5], 2);
  near(at(D, H, 5, 4), 0.5, 1e-9, 'row 4'); near(at(D, H, 5, 5), 0.5, 1e-9, 'row 5');
});

test('scope: a steep line spreads a column\'s time evenly over the rows it crosses', () => {
  const W = 4, H = 40, D = grid(W, H);
  depositTrace(D, W, H, [0, 4], [0, 40], 2);       // 10 rows per column
  for (let r = 12; r < 18; r++) near(at(D, H, 1, r), 0.1, 0.02, `row ${r} of column 1`);
});

test('scope: every column the trace crosses holds its duration, whatever the trace does', () => {
  const W = 50, H = 60, n = 3001, X = [], Y = [];
  for (let i = 0; i < n; i++) { X.push((W * i) / (n - 1)); Y.push(30 + 25 * Math.sin(i * 0.9) * Math.cos(i * 0.013)); }
  const D = grid(W, H);
  depositTrace(D, W, H, X, Y, n);
  for (let c = 2; c < W - 2; c++) near(colSum(D, W, H, c), 1, 1e-6, `column ${c}`);
});

test('scope: a band of many cycles is brightest at its turning points', () => {
  const W = 10, H = 100, n = 20001, X = [], Y = [];
  for (let i = 0; i < n; i++) { X.push((W * i) / (n - 1)); Y.push(50 + 40 * Math.sin(i * 0.05)); }   // ~16 cycles per column
  const D = grid(W, H);
  depositTrace(D, W, H, X, Y, n);
  const c = 5, edge = at(D, H, c, 11), mid = at(D, H, c, 50);
  assert(edge > 2.5 * mid, `the turning point (${edge}) should hold far more time than the middle (${mid})`);
  near(mid, 1 / (Math.PI * 40), 0.3 / (Math.PI * 40), 'the middle: 1/(π A) of the time per row');
});

test('scope: a spike shorter than a column still touches every row it crosses', () => {
  const W = 10, H = 100, D = grid(W, H), T = grid(W, H);
  depositTrace(D, W, H, [0, 5, 5.05, 5.1, 10], [90, 90, 10, 90, 90], 5, 0, null, T);
  for (let r = 20; r < 80; r += 10) {
    const t = at(T, H, 4, r) + at(T, H, 5, r);
    assert(t > 0.9, `row ${r} touched (${t})`);
    assert(at(D, H, 4, r) + at(D, H, 5, r) < 0.01, `but only briefly (${at(D, H, 5, r)})`);
  }
});

test('scope: the trace leaving the grid deposits nothing outside it and nothing throws', () => {
  const W = 10, H = 10, D = grid(W, H);
  const [r0, r1] = depositTrace(D, W, H, [-5, 15, 16, 30], [-20, 30, NaN, 5], 4);
  assert(r0 >= 0 && r1 <= H - 1, `rows ${r0}..${r1}`);
  for (const v of D) assert(Number.isFinite(v) && v >= 0, 'finite, non-negative');
});

test('scope: the picture: a line opaque, a band graded, a brief spike at the floor, and everything cleared after', () => {
  const W = 30, H = 100, n = 6001, X = [], Y = [];
  // columns 0-9: a flat line; 10-19: a band of many cycles; 20-29: flat with a spike at 25.
  for (let i = 0; i < n; i++) {
    const x = (W * i) / (n - 1); X.push(x);
    Y.push(x < 10 ? 20.5 : x < 20 ? 50 + 40 * Math.sin(i * 0.5) : Math.abs(x - 25.2) < 0.02 ? 5 : 80.5);
  }
  const D = new Float32Array(W * H), T = new Float32Array(W * H), ext = new Float64Array(2 * W), out = new Uint32Array(W * H);
  depositTrace(D, W, H, X, Y, n, 0, ext, T);
  shadeTrace(D, T, W, H, ext, out, 0x0000ff, { floor: 0.5, lut: powLut(0.7) });
  const alpha = (c, r) => out[r * W + c] >>> 24;
  assert(alpha(5, 20) > 250, `the line is opaque (${alpha(5, 20)})`);
  assert((out[20 * W + 5] & 0xffffff) === 0x0000ff, 'in its colour');
  assert(alpha(5, 40) === 0, 'and nothing off it');
  const edge = alpha(15, 11), mid = alpha(15, 50);
  assert(edge > mid && mid > 40, `the band: brightest at its turning points (${edge}), dimmer but there in the middle (${mid})`);
  const spike = Math.max(alpha(25, 40), alpha(24, 40), alpha(26, 40));
  assert(spike >= 0.4 * 255 && spike < 0.6 * 255, `the spike shows at about the floor (${spike})`);
  for (let k = 0; k < W * H; k++) if (D[k] !== 0 || T[k] !== 0) { assert(false, `D and touch cleared (${k}: ${D[k]}, ${T[k]})`); break; }
});

test('scope: band-limited interpolation keeps the samples and finds a sine between them', () => {
  const n = 64, v = new Float64Array(n), w = 2 * Math.PI / 3.3;      // 3.3 samples per cycle
  for (let i = 0; i < n; i++) v[i] = Math.sin(w * i);
  const k = 8, u = upsample(v, n, k);
  assert(u.length === (n - 1) * k + 1, 'length');
  for (let i = 0; i < n; i++) near(u[i * k], v[i], 1e-12, `sample ${i}`);
  let err = 0;
  for (let j = 16 * k; j < 48 * k; j++) err = Math.max(err, Math.abs(u[j] - Math.sin((w * j) / k)));
  assert(err < 0.08, `largest error between samples in the middle: ${err}`);
  let peak = 0; for (let j = 16 * k; j < 48 * k; j++) peak = Math.max(peak, u[j]);
  assert(peak > 0.95, `the peaks between samples come out (${peak}); straight lines would give ${Math.max(...v.slice(16, 48))}`);
});

test('scope: the mode is graded unless asked for fast', () => {
  const was = scopeMode();
  assert(was === 'graded' || was === 'fast', was);
  setScopeMode('fast'); assert(scopeMode() === 'fast', 'fast');
  setScopeMode('anything'); assert(scopeMode() === 'graded', 'anything else: graded');
  setScopeMode(was);
});
