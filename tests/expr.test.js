import { test, assert, close } from './harness.js';
import { parse, tryParse } from '../lib/expr.js';

const at = (src, env = {}, vars = ['x']) => parse(src, { variables: vars }).value(env);

test('arithmetic, precedence and associativity', () => {
  close(at('1+2*3').re, 7, 0);
  close(at('2^3^2').re, 512, 0);
  close(at('-2^2').re, -4, 0);
  close(at('2^-1').re, 0.5, 0);
  close(at('e^-x^2', { x: 2 }).re, Math.exp(-4), 1e-15);
  close(at('1/2x', { x: 4 }).re, 2, 0);       // (1/2) x
  close(at('8/2/2').re, 2, 0);
  close(at('2**3').re, 8, 0);
});

test('implicit multiplication', () => {
  close(at('2x', { x: 3 }).re, 6, 0);
  close(at('3(x+1)', { x: 1 }).re, 6, 0);
  close(at('(x-1)(x+1)', { x: 3 }).re, 8, 0);
  close(at('2 sin(x)', { x: Math.PI / 2 }).re, 2, 1e-15);
  close(at('x0 x', { x: 2, x0: 5 }).re, 10, 0);
  close(at('2pi').re, 2 * Math.PI, 0);
  close(at('x²+x³', { x: 2 }).re, 12, 0);
});

test('comparisons are 0/1 boxes, as in the old presets', () => {
  const e = parse('sin(x/L*pi)(x>0)(x<L)');
  assert(e.parameters.join() === 'L');
  close(e.value({ x: 0.5, L: 1 }).re, 1, 1e-15);
  close(e.value({ x: 1.5, L: 1 }).re, 0, 0);
  close(e.value({ x: -0.5, L: 1 }).re, 0, 0);
});

test('complex numbers', () => {
  let v = at('e^(i*pi)');
  close(v.re, -1, 1e-15); close(v.im, 0, 1e-15);
  v = at('sqrt(-4)');
  close(v.re, 0, 1e-15); close(v.im, 2, 1e-15);
  v = at('(1+2i)(3-i)');
  close(v.re, 5, 1e-15); close(v.im, 5, 1e-15);
  v = at('abs(3+4i)');
  close(v.re, 5, 1e-15); close(v.im, 0, 0);
  v = at('exp(-a*(x-x0)^2+i*p*(x-x0))', { x: 1, a: 1, x0: 0, p: 2 });
  close(v.re, Math.exp(-1) * Math.cos(2), 1e-15); close(v.im, Math.exp(-1) * Math.sin(2), 1e-15);
  v = at('(-8)^(1/3)');
  close(v.re, 1, 1e-14); close(v.im, Math.sqrt(3), 1e-14);
  v = at('(-2)^2');
  close(v.re, 4, 0); close(v.im, 0, 0);
});

test('the old finite-well preset parses and is continuous at x = a', () => {
  const src = 'cos(k*x)(x>-a)(x<a)+cos(k*a)/e^(-sqrt(2*V0-k^2)*abs(a))*e^(-sqrt(2*V0-k^2)*abs(x))((x<-a)+(x>a))';
  const e = parse(src);
  assert(e.parameters.join() === 'V0,a,k', e.parameters.join());
  const env = { V0: 50, a: 1, k: 2.70044 };
  const inside = e.value({ ...env, x: 0.999999 }).re, outside = e.value({ ...env, x: 1.000001 }).re;
  close(inside, outside, 1e-4);
});

test('vectorised evaluation over arrays', () => {
  const xs = Float64Array.from({ length: 101 }, (_, i) => -5 + i * 0.1);
  const e = parse('V0*exp(-x^2/(2 w^2)) + 0*i');
  const v = e.evaluate({ x: xs, V0: 2, w: 1.5 }, xs.length);
  for (let i = 0; i < xs.length; i++) close(v.re[i], 2 * Math.exp(-(xs[i] ** 2) / 4.5), 1e-14);
  const r = parse('x^2/2').evaluate({ x: xs }, xs.length);
  assert(r.im === null, 'real expressions stay real');
  close(r.re[0], 12.5, 1e-12);
});

test('variables shadow functions: theta is the polar angle in 2D, a step in 1D', () => {
  close(at('theta(x)', { x: 2 }).re, 1, 0);
  close(at('theta(x)', { x: 2, theta: 3 }, ['x', 'theta']).re, 6, 0);
});

test('Greek and unicode input', () => {
  const e = parse('ω²x²/2 − π');
  assert(e.parameters.join() === 'omega');
  close(e.value({ x: 1, omega: 2 }).re, 2 - Math.PI, 1e-15);
  close(at('ħ').re, 1, 0);
});

test('helpful errors', () => {
  const cases = [['sin x', 'parentheses'], ['(x+1', 'missing ")"'], ['x+', 'ends too early'],
    ['x)', 'unmatched'], ['2 $ 3', 'unexpected character'], ['sin(1,2)', 'takes 1 argument'], ['', 'empty']];
  for (const [src, want] of cases) {
    const r = tryParse(src);
    assert(r.error && r.error.includes(want), `${src}: got ${r.error}`);
  }
});

test('free parameters exclude constants and variables', () => {
  const e = parse('hbar^2/(2*m) * k^2 + V0*step(x) + pi + e + i', { variables: ['x'] });
  assert(e.parameters.join() === 'V0,k,m', e.parameters.join());
});

test('MathML preview', () => {
  const m = parse('V0*exp(-(x-x0)^2/(2 sigma^2))').mathml();
  assert(m.startsWith('<math>') && m.includes('<mfrac>') && m.includes('σ') && m.includes('<msub>'), m);
  const m2 = parse('1/2x').mathml();
  assert(/<mfrac><mrow><mn>1<\/mn><\/mrow><mrow><mn>2<\/mn><\/mrow><\/mfrac>.*<mi>x<\/mi>/.test(m2), m2);
});

test('speed: a Gaussian packet on 512x512 points', () => {
  const n = 512 * 512, x = new Float64Array(n), y = new Float64Array(n);
  for (let i = 0; i < n; i++) { x[i] = (i % 512) / 32 - 8; y[i] = Math.floor(i / 512) / 32 - 8; }
  const e = parse('exp(-((x-x0)^2+(y-y0)^2)/(4 s^2) + i k x)', { variables: ['x', 'y'] });
  const t0 = performance.now();
  e.evaluate({ x, y, x0: -3, y0: 0, s: 1, k: 5 }, n);
  return `${(performance.now() - t0).toFixed(0)} ms`;
});
