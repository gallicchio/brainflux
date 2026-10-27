import { test, assert } from './harness.js';
import { besselJ, besselY } from '../lib/bessel.js';
import { BESSEL } from './bessel-reference.js';

test('J_m and Y_m against SciPy', () => {
  let worstJ = 0, worstY = 0;
  for (const [m, x, J, Y] of BESSEL) {
    const j = besselJ(m, x)[m], y = besselY(m, x)[m];
    // Relative error, or absolute near zeros (where relative error means nothing).
    const ej = Math.abs(j - J) / Math.max(Math.abs(J), 1e-3 * Math.sqrt(2 / (Math.PI * x)) * (Math.abs(J) < 1e-30 ? 0 : 1) || 1e-300);
    const ey = Math.abs(y - Y) / Math.max(Math.abs(Y), 1e-3 * Math.sqrt(2 / (Math.PI * x)));
    worstJ = Math.max(worstJ, Math.abs(J) < 1e-200 ? 0 : ej);
    worstY = Math.max(worstY, ey);
    assert(ej < 1e-8 || Math.abs(J) < 1e-200, `J_${m}(${x}) = ${j}, SciPy ${J}`);
    assert(ey < 1e-8, `Y_${m}(${x}) = ${y}, SciPy ${Y}`);
  }
  return `worst relative error: J ${worstJ.toExponential(1)}, Y ${worstY.toExponential(1)}`;
});

test('Wronskian J_{m+1} Y_m - J_m Y_{m+1} = 2/(pi x)', () => {
  for (const x of [0.3, 3, 30, 120]) {
    const J = besselJ(30, x), Y = besselY(30, x);
    for (let m = 0; m < 30; m++) {
      const w = J[m + 1] * Y[m] - J[m] * Y[m + 1], want = 2 / (Math.PI * x);
      assert(Math.abs(w - want) < 1e-9 * Math.max(1, Math.abs(J[m + 1] * Y[m])), `x=${x} m=${m}: ${w} vs ${want}`);
    }
  }
});
