// Mathematical expressions typed by students: parse, evaluate over whole arrays, show as MathML.
//
//   const e = parse('V0*exp(-(x-x0)^2/(2 w^2))', { variables: ['x'] });
//   e.parameters            -> ['V0', 'w', 'x0']   (free symbols: the demos make sliders of them)
//   e.evaluate({ x: xs, V0: 5, w: 1, x0: 0 }, xs.length)  -> { re: Float64Array, im: null }
//   e.mathml()              -> '<math>...</math>' for a live preview of what was understood
//
// Syntax: numbers (1, 2.5, 1e-3), + - * / ^ (also **), parentheses, comparisons < > <= >= that
// give 1 or 0 (so (x>0)*(x<1) is a box), implicit multiplication (2x, 3(x+1), (x-1)(x+1),
// x0 sin(x)), and the constants pi, e, i and hbar (= 1 in these demos).  Unicode is accepted
// where students might paste it: π ħ × · − ² ³ and Greek letters.  Exponentiation is right
// associative and binds tighter than unary minus, so -x^2 = -(x^2) and e^-x^2 = e^(-(x^2)).
// Implicit multiplication has the same precedence as *, so 1/2x = (1/2) x; the MathML preview
// shows which reading was taken.
//
// Evaluation is "vectorised": each node of the syntax tree is computed for all points at once,
// so typed expressions run fast on 512 x 512 grids without eval() or new Function().  Values
// are complex; the imaginary part is null while everything stays real.

// ---------------------------------------------------------------------------------- tokens

const GREEK = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', zeta: 'ζ', eta: 'η',
  theta: 'θ', iota: 'ι', kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', rho: 'ρ',
  sigma: 'σ', tau: 'τ', upsilon: 'υ', phi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
  Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π', Sigma: 'Σ',
  Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
};
const FROM_GREEK = Object.fromEntries(Object.entries(GREEK).map(([k, v]) => [v, k]));

export class ExprError extends Error {
  constructor(message, pos) { super(message); this.pos = pos; }
}

function tokenize(src) {
  const tokens = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    const start = i;
    if (/[0-9.]/.test(c)) {
      let m = /^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(src.slice(i));
      if (!m) throw new ExprError(`cannot read a number at "${src.slice(i, i + 5)}"`, i);
      // "2e" followed by a non-digit is 2 times e, not a malformed exponent.
      tokens.push({ t: 'num', v: parseFloat(m[0]), pos: start, end: i + m[0].length });
      i += m[0].length;
      continue;
    }
    if (/[A-Za-z_]/.test(c) || FROM_GREEK[c] || c === 'π' || c === 'ħ') {
      let name;
      if (c === 'π') { name = 'pi'; i++; }
      else if (c === 'ħ') { name = 'hbar'; i++; }
      else if (FROM_GREEK[c]) {
        name = FROM_GREEK[c]; i++;
        const m = /^[A-Za-z0-9_]*/.exec(src.slice(i));
        name += m[0]; i += m[0].length;
      } else {
        const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i));
        name = m[0]; i += m[0].length;
      }
      tokens.push({ t: 'id', v: name, pos: start, end: i });
      continue;
    }
    const two = src.slice(i, i + 2);
    if (two === '**') { tokens.push({ t: 'op', v: '^', pos: i, end: i + 2 }); i += 2; continue; }
    if (two === '<=' || two === '>=') { tokens.push({ t: 'op', v: two, pos: i, end: i + 2 }); i += 2; continue; }
    if (c === '²' || c === '³') {
      tokens.push({ t: 'op', v: '^', pos: i, end: i + 1 });
      tokens.push({ t: 'num', v: c === '²' ? 2 : 3, pos: i, end: i + 1 });
      i++; continue;
    }
    const map = { '×': '*', '·': '*', '⋅': '*', '−': '-', '–': '-', '÷': '/', '≤': '<=', '≥': '>=' };
    const op = map[c] || c;
    if ('+-*/^(),<>|'.includes(op)) { tokens.push({ t: 'op', v: op, pos: i, end: i + 1 }); i++; continue; }
    throw new ExprError(`unexpected character "${c}"`, i);
  }
  tokens.push({ t: 'end', v: '', pos: n, end: n });
  return tokens;
}

// --------------------------------------------------------------------------- the functions

// Each function: [minArgs, maxArgs].  The implementations are in FUNCS below.
const ARITY = {
  sin: [1, 1], cos: [1, 1], tan: [1, 1], sec: [1, 1], csc: [1, 1], cot: [1, 1],
  asin: [1, 1], acos: [1, 1], atan: [1, 2], arcsin: [1, 1], arccos: [1, 1], arctan: [1, 2], atan2: [2, 2],
  sinh: [1, 1], cosh: [1, 1], tanh: [1, 1], sech: [1, 1], csch: [1, 1], coth: [1, 1],
  asinh: [1, 1], acosh: [1, 1], atanh: [1, 1],
  exp: [1, 1], log: [1, 1], ln: [1, 1], log10: [1, 1], sqrt: [1, 1], cbrt: [1, 1],
  abs: [1, 1], sign: [1, 1], sgn: [1, 1], step: [1, 1], H: [1, 1], heaviside: [1, 1], theta: [1, 1],
  rect: [1, 1], sinc: [1, 1], gauss: [1, 1],
  min: [2, 2], max: [2, 2], floor: [1, 1], ceil: [1, 1], round: [1, 1], mod: [2, 2],
  re: [1, 1], im: [1, 1], real: [1, 1], imag: [1, 1], conj: [1, 1], arg: [1, 1],
};
const ALIAS = { arcsin: 'asin', arccos: 'acos', arctan: 'atan', ln: 'log', sgn: 'sign', H: 'step',
  heaviside: 'step', theta: 'step', real: 're', imag: 'im' };
export const FUNCTION_NAMES = Object.keys(ARITY);
const CONSTANTS = { pi: Math.PI, e: Math.E, hbar: 1 };

// ---------------------------------------------------------------------------------- parser

// Precedences, used by the MathML writer to decide on parentheses.
const PREC = { cmp: 0, add: 1, mul: 2, neg: 3, pow: 4, atom: 5 };

function parseTokens(tokens, variables) {
  let p = 0;
  const peek = () => tokens[p];
  const next = () => tokens[p++];
  const isOp = (v) => peek().t === 'op' && peek().v === v;
  const expect = (v, what) => {
    if (!isOp(v)) {
      const tk = peek();
      throw new ExprError(tk.t === 'end' ? `missing "${v}"${what ? ' ' + what : ''}` : `expected "${v}" but found "${tk.v}"`, tk.pos);
    }
    return next();
  };

  // A chain a < b < c means what it says, (a < b) and (b < c), as in mathematics (not
  // ((a < b) < c), as in most programming languages).
  function comparison() {
    const first = additive();
    const terms = [first], ops = [];
    while (peek().t === 'op' && ['<', '>', '<=', '>='].includes(peek().v)) {
      ops.push(next().v);
      terms.push(additive());
    }
    if (!ops.length) return first;
    if (ops.length === 1) return { type: 'cmp', op: ops[0], a: terms[0], b: terms[1] };
    return { type: 'chain', ops, terms };
  }
  function additive() {
    let a = multiplicative();
    while (isOp('+') || isOp('-')) {
      const op = next().v;
      a = { type: 'bin', op, a, b: multiplicative() };
    }
    return a;
  }
  function startsAtom(tk) {
    return tk.t === 'num' || tk.t === 'id' || (tk.t === 'op' && (tk.v === '(' || tk.v === '|'));
  }
  function multiplicative() {
    let a = unary();
    for (;;) {
      if (isOp('*') || isOp('/')) {
        const op = next().v;
        a = { type: 'bin', op, a, b: unary() };
      } else if (startsAtom(peek()) && !(isOp('|') && absDepth > 0)) {
        // Implicit multiplication: 2x, x(x+1), (a)(b), 2 sin(x).
        a = { type: 'bin', op: '*', a, b: power(), implicit: true };
      } else return a;
    }
  }
  function unary() {
    if (isOp('-')) { next(); return { type: 'neg', a: unary() }; }
    if (isOp('+')) { next(); return unary(); }
    return power();
  }
  function power() {
    const base = atom();
    if (isOp('^')) {
      next();
      // The exponent may carry its own sign: e^-x^2.
      let negate = false;
      while (isOp('-') || isOp('+')) { if (next().v === '-') negate = !negate; }
      let ex = power();
      if (negate) ex = { type: 'neg', a: ex };
      return { type: 'bin', op: '^', a: base, b: ex };
    }
    return base;
  }
  let absDepth = 0;
  function atom() {
    const tk = next();
    if (tk.t === 'num') return { type: 'num', v: tk.v };
    if (tk.t === 'op' && tk.v === '(') {
      const e = comparison();
      expect(')', `to close the "(" at position ${tk.pos + 1}`);
      return { type: 'group', a: e };
    }
    if (tk.t === 'op' && tk.v === '|') {
      absDepth++;
      const e = comparison();
      absDepth--;
      expect('|', 'to close the absolute value');
      return { type: 'call', name: 'abs', args: [e] };
    }
    if (tk.t === 'id') {
      const name = tk.v;
      const isVariable = variables.includes(name);
      if (!isVariable && ARITY[name] && isOp('(')) {
        next();
        const args = [];
        if (!isOp(')')) {
          args.push(comparison());
          while (isOp(',')) { next(); args.push(comparison()); }
        }
        expect(')', `to close ${name}(`);
        const [lo, hi] = ARITY[name];
        if (args.length < lo || args.length > hi) {
          throw new ExprError(`${name} takes ${lo === hi ? lo : lo + ' or ' + hi} argument${hi > 1 ? 's' : ''}`, tk.pos);
        }
        return { type: 'call', name, args };
      }
      if (!isVariable && ARITY[name] && !CONSTANTS[name] && name.length > 1) {
        throw new ExprError(`${name} needs parentheses: ${name}(...)`, tk.pos);
      }
      if (name === 'i' && !isVariable) return { type: 'imag' };
      if (CONSTANTS[name] !== undefined && !isVariable) return { type: 'const', name };
      return { type: 'var', name };
    }
    if (tk.t === 'end') throw new ExprError('the expression ends too early', tk.pos);
    throw new ExprError(`unexpected "${tk.v}"`, tk.pos);
  }

  if (peek().t === 'end') throw new ExprError('empty expression', 0);
  const tree = comparison();
  if (peek().t !== 'end') {
    const tk = peek();
    throw new ExprError(tk.v === ')' ? 'unmatched ")"' : `unexpected "${tk.v}"`, tk.pos);
  }
  return tree;
}

function collectNames(node, out) {
  switch (node.type) {
    case 'var': out.add(node.name); break;
    case 'bin': case 'cmp': collectNames(node.a, out); collectNames(node.b, out); break;
    case 'chain': node.terms.forEach((t) => collectNames(t, out)); break;
    case 'neg': case 'group': collectNames(node.a, out); break;
    case 'call': node.args.forEach((a) => collectNames(a, out)); break;
  }
  return out;
}

// ------------------------------------------------------------------------------ evaluation
//
// A value is { re, im } where re is a number or a Float64Array of length n, and im is null
// (exactly real), a number, or a Float64Array.

const isArr = (v) => typeof v !== 'number';

function vec(v, n) {
  if (isArr(v)) return v;
  return new Float64Array(n).fill(v);
}

// Apply a real function elementwise to a real value.
function mapReal(a, f) {
  if (!isArr(a)) return f(a);
  const out = new Float64Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = f(a[i]);
  return out;
}

function mapReal2(a, b, n, f) {
  if (!isArr(a) && !isArr(b)) return f(a, b);
  const out = new Float64Array(n);
  if (isArr(a) && isArr(b)) for (let i = 0; i < n; i++) out[i] = f(a[i], b[i]);
  else if (isArr(a)) for (let i = 0; i < n; i++) out[i] = f(a[i], b);
  else for (let i = 0; i < n; i++) out[i] = f(a, b[i]);
  return out;
}

// Elementwise complex operation: f(ar, ai, br, bi) -> sets out[0], out[1].
function mapComplex2(A, B, n, f) {
  const scalar = !isArr(A.re) && !isArr(A.im ?? 0) && !isArr(B.re) && !isArr(B.im ?? 0);
  const o = [0, 0];
  const get = (v, i) => (v === null ? 0 : isArr(v) ? v[i] : v);
  if (scalar) { f(A.re, A.im ?? 0, B.re, B.im ?? 0, o); return { re: o[0], im: o[1] }; }
  const re = new Float64Array(n), im = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    f(get(A.re, i), get(A.im, i), get(B.re, i), get(B.im, i), o);
    re[i] = o[0]; im[i] = o[1];
  }
  return { re, im };
}

function mapComplex1(A, n, f) {
  const o = [0, 0];
  if (!isArr(A.re) && !isArr(A.im ?? 0)) { f(A.re, A.im ?? 0, o); return { re: o[0], im: o[1] }; }
  const re = new Float64Array(n), im = new Float64Array(n);
  const get = (v, i) => (v === null ? 0 : isArr(v) ? v[i] : v);
  for (let i = 0; i < n; i++) { f(get(A.re, i), get(A.im, i), o); re[i] = o[0]; im[i] = o[1]; }
  return { re, im };
}

// Complex elementary functions, written into o = [re, im].
const C = {
  exp(a, b, o) { const e = Math.exp(a); o[0] = e * Math.cos(b); o[1] = e * Math.sin(b); },
  log(a, b, o) { o[0] = 0.5 * Math.log(a * a + b * b); o[1] = Math.atan2(b, a); },
  sqrt(a, b, o) {
    const r = Math.hypot(a, b);
    if (r === 0) { o[0] = 0; o[1] = 0; return; }
    const t = Math.sqrt((r + Math.abs(a)) / 2);
    if (a >= 0) { o[0] = t; o[1] = b / (2 * t); } else { o[0] = Math.abs(b) / (2 * t); o[1] = b < 0 ? -t : t; }
  },
  sin(a, b, o) { o[0] = Math.sin(a) * Math.cosh(b); o[1] = Math.cos(a) * Math.sinh(b); },
  cos(a, b, o) { o[0] = Math.cos(a) * Math.cosh(b); o[1] = -Math.sin(a) * Math.sinh(b); },
  sinh(a, b, o) { o[0] = Math.sinh(a) * Math.cos(b); o[1] = Math.cosh(a) * Math.sin(b); },
  cosh(a, b, o) { o[0] = Math.cosh(a) * Math.cos(b); o[1] = Math.sinh(a) * Math.sin(b); },
  mul(a, b, c, d, o) { o[0] = a * c - b * d; o[1] = a * d + b * c; },
  div(a, b, c, d, o) {
    const q = c * c + d * d;
    o[0] = (a * c + b * d) / q; o[1] = (b * c - a * d) / q;
  },
  pow(a, b, c, d, o) {
    if (a === 0 && b === 0) { o[0] = c === 0 && d === 0 ? 1 : 0; o[1] = 0; return; }
    // Integer real exponents by repeated multiplication keep (-1)^2 exactly real.
    if (d === 0 && Number.isInteger(c) && Math.abs(c) <= 64) {
      let rr = 1, ri = 0, br = a, bi = b, k = Math.abs(c);
      while (k) {
        if (k & 1) { const t = rr * br - ri * bi; ri = rr * bi + ri * br; rr = t; }
        const t = br * br - bi * bi; bi = 2 * br * bi; br = t;
        k >>= 1;
      }
      if (c < 0) { const q = rr * rr + ri * ri; rr /= q; ri = -ri / q; }
      o[0] = rr; o[1] = ri; return;
    }
    const lr = 0.5 * Math.log(a * a + b * b), li = Math.atan2(b, a);
    const er = c * lr - d * li, ei = c * li + d * lr;
    const m = Math.exp(er);
    o[0] = m * Math.cos(ei); o[1] = m * Math.sin(ei);
  },
};

function cdiv1(f) { // 1/f(z)
  return (a, b, o) => { f(a, b, o); const q = o[0] * o[0] + o[1] * o[1]; o[0] /= q; o[1] = -o[1] / q; };
}
function cquot(f, g) { // f(z)/g(z)
  const t = [0, 0];
  return (a, b, o) => { f(a, b, t); g(a, b, o); C.div(t[0], t[1], o[0], o[1], o); };
}
C.tan = cquot(C.sin, C.cos);
C.tanh = cquot(C.sinh, C.cosh);
C.sec = cdiv1(C.cos); C.csc = cdiv1(C.sin); C.cot = cquot(C.cos, C.sin);
C.sech = cdiv1(C.cosh); C.csch = cdiv1(C.sinh); C.coth = cquot(C.cosh, C.sinh);

const sinc = (x) => (Math.abs(x) < 1e-8 ? 1 - (x * x) / 6 : Math.sin(x) / x);

// Real implementations; functions marked complexToo also have a complex form in C.
const REAL = {
  sin: Math.sin, cos: Math.cos, tan: Math.tan,
  sec: (x) => 1 / Math.cos(x), csc: (x) => 1 / Math.sin(x), cot: (x) => 1 / Math.tan(x),
  sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh,
  sech: (x) => 1 / Math.cosh(x), csch: (x) => 1 / Math.sinh(x), coth: (x) => 1 / Math.tanh(x),
  asinh: Math.asinh, exp: Math.exp, cbrt: Math.cbrt, atan: Math.atan,
  abs: Math.abs, sign: Math.sign, step: (x) => (x > 0 ? 1 : x < 0 ? 0 : 0.5),
  rect: (x) => (Math.abs(x) < 0.5 ? 1 : Math.abs(x) === 0.5 ? 0.5 : 0),
  sinc, gauss: (x) => Math.exp(-x * x),
  floor: Math.floor, ceil: Math.ceil, round: Math.round,
  log10: Math.log10,
};
// Real functions whose real domain is limited; outside it the result is complex.
const LIMITED = {
  sqrt: [(x) => x >= 0, Math.sqrt],
  log: [(x) => x > 0, Math.log],
  asin: [(x) => x >= -1 && x <= 1, Math.asin],
  acos: [(x) => x >= -1 && x <= 1, Math.acos],
  acosh: [(x) => x >= 1, Math.acosh],
  atanh: [(x) => x > -1 && x < 1, Math.atanh],
};

function allInDomain(v, ok) {
  if (!isArr(v)) return ok(v);
  for (let i = 0; i < v.length; i++) if (!ok(v[i])) return false;
  return true;
}

const CMP = { '<': (a, b) => +(a < b), '>': (a, b) => +(a > b), '<=': (a, b) => +(a <= b), '>=': (a, b) => +(a >= b) };

function evalNode(node, env, n) {
  switch (node.type) {
    case 'num': return { re: node.v, im: null };
    case 'const': return { re: CONSTANTS[node.name], im: null };
    case 'imag': return { re: 0, im: 1 };
    case 'group': return evalNode(node.a, env, n);
    case 'var': {
      const v = env[node.name];
      if (v === undefined) throw new ExprError(`no value for ${node.name}`, 0);
      if (typeof v === 'number' || v instanceof Float64Array || Array.isArray(v)) {
        return { re: Array.isArray(v) ? Float64Array.from(v) : v, im: null };
      }
      return { re: v.re, im: v.im ?? null }; // complex value supplied
    }
    case 'neg': {
      const A = evalNode(node.a, env, n);
      return { re: mapReal(A.re, (x) => -x), im: A.im === null ? null : mapReal(A.im, (x) => -x) };
    }
    case 'cmp': {
      const A = evalNode(node.a, env, n), B = evalNode(node.b, env, n);
      return { re: mapReal2(A.re, B.re, n, CMP[node.op]), im: null };
    }
    case 'chain': {
      // The product of each link's 0/1.
      const vals = node.terms.map((t) => evalNode(t, env, n).re);
      let out = mapReal2(vals[0], vals[1], n, CMP[node.ops[0]]);
      for (let i = 1; i < node.ops.length; i++) {
        const link = mapReal2(vals[i], vals[i + 1], n, CMP[node.ops[i]]);
        out = mapReal2(out, link, n, (a, b) => a * b);
      }
      return { re: out, im: null };
    }
    case 'bin': return evalBinary(node.op, evalNode(node.a, env, n), evalNode(node.b, env, n), n);
    case 'call': return evalCall(node, env, n);
  }
  throw new Error('bad node ' + node.type);
}

function evalBinary(op, A, B, n) {
  const real = A.im === null && B.im === null;
  switch (op) {
    case '+': case '-': {
      const s = op === '+' ? 1 : -1;
      const re = mapReal2(A.re, B.re, n, (a, b) => a + s * b);
      if (real) return { re, im: null };
      return { re, im: mapReal2(A.im ?? 0, B.im ?? 0, n, (a, b) => a + s * b) };
    }
    case '*':
      if (real) return { re: mapReal2(A.re, B.re, n, (a, b) => a * b), im: null };
      return mapComplex2(A, B, n, C.mul);
    case '/':
      if (real) return { re: mapReal2(A.re, B.re, n, (a, b) => a / b), im: null };
      return mapComplex2(A, B, n, C.div);
    case '^': {
      if (real) {
        // Stay real when every base is non-negative or the exponent is an integer.
        const intExp = !isArr(B.re) ? Number.isInteger(B.re) : B.re.every(Number.isInteger);
        if (intExp || allInDomain(A.re, (x) => x >= 0)) {
          if (!isArr(B.re) && B.re === 2) return { re: mapReal(A.re, (x) => x * x), im: null };
          return { re: mapReal2(A.re, B.re, n, Math.pow), im: null };
        }
      }
      return mapComplex2(A, B, n, C.pow);
    }
  }
  throw new Error('bad operator ' + op);
}

function evalCall(node, env, n) {
  const name = ALIAS[node.name] || node.name;
  const args = node.args.map((a) => evalNode(a, env, n));
  const A = args[0];
  const real = args.every((v) => v.im === null);
  switch (name) {
    case 'atan':
      if (args.length === 2) return { re: mapReal2(A.re, args[1].re, n, Math.atan2), im: null };
      break;
    case 'atan2': return { re: mapReal2(A.re, args[1].re, n, Math.atan2), im: null };
    case 'min': return { re: mapReal2(A.re, args[1].re, n, Math.min), im: null };
    case 'max': return { re: mapReal2(A.re, args[1].re, n, Math.max), im: null };
    case 'mod': return { re: mapReal2(A.re, args[1].re, n, (a, b) => a - b * Math.floor(a / b)), im: null };
    case 're': return { re: A.re, im: null };
    case 'im': return { re: A.im === null ? 0 : A.im, im: null };
    case 'conj': return { re: A.re, im: A.im === null ? null : mapReal(A.im, (x) => -x) };
    case 'arg': return { re: A.im === null ? mapReal(A.re, (x) => (x < 0 ? Math.PI : 0)) : mapReal2(A.im, A.re, n, Math.atan2), im: null };
    case 'abs':
      if (A.im === null) return { re: mapReal(A.re, Math.abs), im: null };
      return { re: mapReal2(A.re, A.im, n, Math.hypot), im: null };
  }
  if (real) {
    if (LIMITED[name]) {
      const [ok, f] = LIMITED[name];
      if (allInDomain(A.re, ok)) return { re: mapReal(A.re, f), im: null };
      if (C[name]) return mapComplex1(A, n, C[name]);
      // asin/acos/acosh/atanh outside their domain: give NaN, which the demos report.
      return { re: mapReal(A.re, f), im: null };
    }
    if (REAL[name]) return { re: mapReal(A.re, REAL[name]), im: null };
  }
  if (C[name]) return mapComplex1(A, n, C[name]);
  // Real-only functions (step, rect, floor, ...) act on the real part.
  if (REAL[name]) return { re: mapReal(A.re, REAL[name]), im: null };
  if (LIMITED[name]) return { re: mapReal(A.re, LIMITED[name][1]), im: null };
  throw new ExprError(`${node.name} of a complex number is not available`, 0);
}

// ----------------------------------------------------------------------------- the object

export class Expression {
  constructor(source, tree, variables) {
    this.source = source;
    this.tree = tree;
    this.variables = variables;
    const names = collectNames(tree, new Set());
    this.names = [...names];
    this.parameters = this.names.filter((v) => !variables.includes(v)).sort();
    this.usesI = /"type":"imag"/.test(JSON.stringify(tree));
  }

  /** True if the expression mentions the symbol (e.g. 't' for a time-dependent potential). */
  uses(name) { return this.names.includes(name); }

  /**
   * Evaluate for n points.  env maps names to numbers, Float64Arrays of length n, or
   * {re, im} pairs.  Returns {re: Float64Array, im: Float64Array|null} (scalars broadcast).
   */
  evaluate(env, n) {
    const v = evalNode(this.tree, env, n);
    return { re: vec(v.re, n), im: v.im === null ? null : vec(v.im, n) };
  }

  /** Evaluate once, as a complex number {re, im}. */
  value(env = {}) {
    const v = evalNode(this.tree, env, 1);
    const pick = (x) => (x === null ? 0 : isArr(x) ? x[0] : x);
    return { re: pick(v.re), im: pick(v.im) };
  }

  mathml(display = false) {
    return `<math${display ? ' display="block"' : ''}>${toMathML(this.tree)}</math>`;
  }
}

/**
 * Parse an expression.  options.variables lists the coordinate names (e.g. ['x'] or
 * ['x', 'y', 'r', 'theta', 't']); every other unknown name is a parameter.
 */
export function parse(source, options = {}) {
  const variables = options.variables || ['x'];
  const tree = parseTokens(tokenize(String(source)), variables);
  return new Expression(source, tree, variables);
}

/** Parse without throwing: { expr } or { error, pos }. */
export function tryParse(source, options) {
  try { return { expr: parse(source, options) }; }
  catch (e) {
    if (e instanceof ExprError) return { error: e.message, pos: e.pos };
    throw e;
  }
}

// ---------------------------------------------------------------------------------- MathML

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** An identifier as MathML: V0 -> V with subscript 0, sigma -> σ, x_max -> x with subscript max. */
export function identifierMathML(name) {
  if (name === 'hbar') return '<mi>ħ</mi>';
  if (name === 'pi') return '<mi>π</mi>';
  let m = /^([A-Za-z]+?)_?([0-9]+)$/.exec(name);
  let base = name, sub = '';
  if (m && (GREEK[m[1]] || m[1].length === 1 || /_/.test(name))) { base = m[1]; sub = m[2]; }
  else if ((m = /^([A-Za-z]+)_([A-Za-z0-9]+)$/.exec(name))) { base = m[1]; sub = m[2]; }
  const shown = GREEK[base] || base;
  const mi = shown.length > 1 ? `<mi mathvariant="normal">${esc(shown)}</mi>` : `<mi>${esc(shown)}</mi>`;
  if (!sub) return shown.length > 1 ? `<mi>${esc(shown)}</mi>` : mi;
  const subEl = /^[0-9]+$/.test(sub) ? `<mn>${sub}</mn>` : `<mi>${esc(GREEK[sub] || sub)}</mi>`;
  return `<msub>${mi}${subEl}</msub>`;
}

function prec(node) {
  switch (node.type) {
    case 'cmp': case 'chain': return PREC.cmp;
    case 'bin': return node.op === '+' || node.op === '-' ? PREC.add : node.op === '^' ? PREC.pow : node.op === '/' ? PREC.atom : PREC.mul;
    case 'neg': return PREC.neg;
    case 'num': return node.v < 0 ? PREC.neg : PREC.atom;
    default: return PREC.atom;
  }
}

const paren = (s) => `<mrow><mo>(</mo>${s}<mo>)</mo></mrow>`;
const unwrap = (node) => (node.type === 'group' ? unwrap(node.a) : node);

function numberMathML(v) {
  let s = Number.isInteger(v) ? String(v) : String(+v.toPrecision(10));
  const m = /^(-?[0-9.]+)e([+-]?)(\d+)$/.exec(s);
  if (m) return `<mrow><mn>${m[1]}</mn><mo>×</mo><msup><mn>10</mn><mn>${m[2] === '-' ? '−' : ''}${m[3]}</mn></msup></mrow>`;
  return `<mn>${s}</mn>`;
}

// Does the MathML of this node start with a digit (so "2·3" needs a visible dot)?
function startsWithNumber(node) {
  node = unwrap(node);
  if (node.type === 'num') return true;
  if (node.type === 'bin' && node.op !== '/') return startsWithNumber(node.a);
  return false;
}

function toMathML(node) {
  switch (node.type) {
    case 'num': return numberMathML(node.v);
    case 'const': return node.name === 'e' ? '<mi mathvariant="normal">e</mi>' : identifierMathML(node.name);
    case 'imag': return '<mi mathvariant="normal">i</mi>';
    case 'var': return identifierMathML(node.name);
    case 'group': {
      // Keep the student's parentheses only where they matter; toMathML adds the needed ones.
      return toMathML(node.a);
    }
    case 'neg': {
      const a = unwrap(node.a);
      const inner = prec(a) <= PREC.add ? paren(toMathML(a)) : toMathML(a);
      return `<mrow><mo>−</mo>${inner}</mrow>`;
    }
    case 'chain': {
      const sym = { '<': '&lt;', '>': '&gt;', '<=': '≤', '>=': '≥' };
      return `<mrow>${node.terms.map((t, i) => (i ? `<mo>${sym[node.ops[i - 1]]}</mo>` : '') + toMathML(unwrap(t))).join('')}</mrow>`;
    }
    case 'cmp': {
      const op = { '<': '&lt;', '>': '&gt;', '<=': '≤', '>=': '≥' }[node.op];
      const a = unwrap(node.a), b = unwrap(node.b);
      return `<mrow>${toMathML(a)}<mo>${op}</mo>${prec(b) <= PREC.cmp ? paren(toMathML(b)) : toMathML(b)}</mrow>`;
    }
    case 'bin': {
      const a = unwrap(node.a), b = unwrap(node.b);
      if (node.op === '/') return `<mfrac><mrow>${toMathML(a)}</mrow><mrow>${toMathML(b)}</mrow></mfrac>`;
      if (node.op === '^') {
        const base = prec(a) < PREC.atom || a.type === 'bin' ? paren(toMathML(a)) : toMathML(a);
        // Comparisons in a factor are boxes; show them as such.
        return `<msup>${base}<mrow>${toMathML(b)}</mrow></msup>`;
      }
      if (node.op === '+' || node.op === '-') {
        const right = (prec(b) <= PREC.add && node.op === '-') || prec(b) < PREC.add ? paren(toMathML(b)) : toMathML(b);
        const left = prec(a) < PREC.add ? paren(toMathML(a)) : toMathML(a);
        return `<mrow>${left}<mo>${node.op === '-' ? '−' : '+'}</mo>${right}</mrow>`;
      }
      // Multiplication: invisible, except between numbers.
      const left = prec(a) < PREC.mul || a.type === 'cmp' ? paren(toMathML(a)) : toMathML(a);
      const right = prec(b) <= PREC.mul && !(b.type === 'bin' && b.op === '^') || b.type === 'cmp' || b.type === 'neg'
        ? paren(toMathML(b)) : toMathML(b);
      const op = startsWithNumber(b) ? '<mo>·</mo>' : '<mo>&#x2062;</mo>';
      return `<mrow>${left}${op}${right}</mrow>`;
    }
    case 'call': {
      const name = ALIAS[node.name] === 'step' ? 'step' : node.name;
      const args = node.args.map((x) => toMathML(unwrap(x)));
      if (name === 'sqrt') return `<msqrt>${args[0]}</msqrt>`;
      if (name === 'cbrt') return `<mroot><mrow>${args[0]}</mrow><mn>3</mn></mroot>`;
      if (name === 'abs') return `<mrow><mo>|</mo>${args[0]}<mo>|</mo></mrow>`;
      if (name === 'exp') {
        return `<msup><mi mathvariant="normal">e</mi><mrow>${args[0]}</mrow></msup>`;
      }
      if (name === 'step') return `<mrow><mi mathvariant="normal">Θ</mi>${paren(args[0])}</mrow>`;
      if (name === 'conj') return `<msup>${paren(args[0])}<mo>*</mo></msup>`;
      const shown = { re: 'Re', im: 'Im', real: 'Re', imag: 'Im' }[name] || name;
      return `<mrow><mi>${shown}</mi><mo>&#x2061;</mo>${paren(args.join('<mo>,</mo>'))}</mrow>`;
    }
  }
  return '<merror><mtext>?</mtext></merror>';
}
