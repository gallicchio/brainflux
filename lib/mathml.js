// A small TeX-to-MathML translator for the explanations in the demos.
//
// Browsers draw MathML natively, so writing $i\hbar \partial_t \psi = H\psi$ in a page and
// calling renderMath(element) is all it takes; no MathJax, no KaTeX, nothing to keep up to date.
// Only the common part of TeX math is understood: letters, numbers, operators, ^ and _, \frac,
// \sqrt, \left...\right, accents (\vec \hat \tilde \bar \dot \ddot), \mathrm/\text/\mathbf,
// Greek letters and the usual symbols.  Anything else shows up in red, so it is noticed.

const SYMBOLS = {
  // Greek
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ϵ', varepsilon: 'ε', zeta: 'ζ',
  eta: 'η', theta: 'θ', vartheta: 'ϑ', iota: 'ι', kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν',
  xi: 'ξ', pi: 'π', rho: 'ρ', sigma: 'σ', tau: 'τ', upsilon: 'υ', phi: 'ϕ', varphi: 'φ',
  chi: 'χ', psi: 'ψ', omega: 'ω', Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ',
  Pi: 'Π', Sigma: 'Σ', Upsilon: 'Υ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
  // letter-like
  hbar: 'ℏ', ell: 'ℓ', partial: '∂', nabla: '∇', infty: '∞', Re: 'Re', Im: 'Im',
};
const OPERATORS = {
  cdot: '·', times: '×', pm: '±', mp: '∓', le: '≤', leq: '≤', ge: '≥', geq: '≥', ne: '≠',
  neq: '≠', approx: '≈', sim: '∼', simeq: '≃', equiv: '≡', propto: '∝', to: '→',
  rightarrow: '→', leftarrow: '←', Rightarrow: '⇒', Leftrightarrow: '⇔', mapsto: '↦',
  in: '∈', langle: '⟨', rangle: '⟩', int: '∫', oint: '∮', iint: '∬', sum: '∑', prod: '∏',
  lvert: '|', rvert: '|', vert: '|', Vert: '‖', dagger: '†', ast: '∗', circ: '∘', star: '⋆',
  ldots: '…', cdots: '⋯', dots: '…', gg: '≫', ll: '≪', perp: '⊥', parallel: '∥', cdotp: '·',
  lbrace: '{', rbrace: '}', lfloor: '⌊', rfloor: '⌋', mid: '|', setminus: '∖', cap: '∩',
  cup: '∪', forall: '∀', exists: '∃', neg: '¬', wedge: '∧', vee: '∨', oplus: '⊕', otimes: '⊗',
};
const LARGE = new Set(['∫', '∮', '∬', '∑', '∏']);
const FUNCTIONS = new Set(['sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'sinh', 'cosh', 'tanh',
  'exp', 'ln', 'log', 'det', 'max', 'min', 'arg', 'lim', 'sup', 'inf', 'arcsin', 'arccos',
  'arctan', 'sgn', 'Tr', 'tr']);
const ACCENTS = { vec: '→', hat: '^', tilde: '~', bar: '‾', dot: '˙', ddot: '¨', overline: '‾' };
const SPACES = { ',': '0.1667em', ':': '0.2222em', ';': '0.2778em', quad: '1em', qquad: '2em', ' ': '0.25em', '!': '-0.1667em' };

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const TEXTUAL = new Set(['text', 'textrm', 'mathrm', 'operatorname']);

function tokenize(src) {
  const out = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '\\') {
      const m = /^\\([A-Za-z]+|.)/.exec(src.slice(i));
      out.push({ cmd: m[1] });
      i += m[0].length;
      // A command name swallows the spaces after it.
      if (/[A-Za-z]/.test(m[1][0])) while (src[i] === ' ') i++;
      // \text{...} keeps its spaces, so its argument is read here, before spaces are dropped.
      if (TEXTUAL.has(m[1]) && src[i] === '{') {
        let depth = 0, j = i;
        for (; j < src.length; j++) {
          if (src[j] === '\\') { j++; continue; }
          if (src[j] === '{') depth++;
          if (src[j] === '}' && --depth === 0) break;
        }
        out[out.length - 1].raw = src.slice(i + 1, j).replace(/\\([%$&#_{} ])/g, '$1');
        i = j + 1;
      }
    } else if (/\s/.test(c)) i++;
    else if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] || ''))) {
      const m = /^[0-9]*\.?[0-9]+|^[0-9]+\.?/.exec(src.slice(i));
      out.push({ num: m[0] });
      i += m[0].length;
    } else { out.push({ ch: c }); i++; }
  }
  return out;
}

class Parser {
  constructor(tokens, display) { this.t = tokens; this.p = 0; this.display = display; }
  peek() { return this.t[this.p]; }
  next() { return this.t[this.p++]; }
  atEnd() { return this.p >= this.t.length; }

  // A sequence of atoms until } or \right or the end.
  sequence(stopAtRight = false) {
    const parts = [];
    while (!this.atEnd()) {
      const tk = this.peek();
      if (tk.ch === '}') break;
      if (stopAtRight && tk.cmd === 'right') break;
      parts.push(this.scripted());
    }
    return parts.join('');
  }

  // A required argument: {...} or a single token (one digit of a number: \frac12 is 1/2).
  argument() {
    const tk = this.peek();
    if (!tk) return '<mrow></mrow>';
    if (tk.num !== undefined && tk.num.length > 1) {
      const first = tk.num[0];
      tk.num = tk.num.slice(1);
      return `<mn>${first}</mn>`;
    }
    if (tk.ch === '{') {
      this.next();
      const s = this.sequence();
      if (this.peek() && this.peek().ch === '}') this.next();
      return `<mrow>${s}</mrow>`;
    }
    return this.atom();
  }

  rawArgument() { // the text inside {...}, for \text and friends
    if (!this.peek() || this.peek().ch !== '{') return '';
    this.next();
    let depth = 1, s = '';
    while (!this.atEnd()) {
      const tk = this.next();
      if (tk.ch === '{') depth++;
      if (tk.ch === '}' && --depth === 0) break;
      s += tk.cmd !== undefined ? (tk.cmd === ' ' ? ' ' : '\\' + tk.cmd + ' ') : tk.num ?? tk.ch;
    }
    return s;
  }

  scripted() {
    let base = this.atom();
    let sub = null, sup = null, primes = '';
    for (;;) {
      const tk = this.peek();
      if (!tk) break;
      if (tk.ch === '_' && sub === null) { this.next(); sub = this.argument(); }
      else if (tk.ch === '^' && sup === null) { this.next(); sup = this.argument(); }
      else if (tk.ch === "'") { this.next(); primes += '′'; }
      else break;
    }
    if (primes) sup = sup ? `<mrow><mo>${primes}</mo>${sup}</mrow>` : `<mo>${primes}</mo>`;
    // A function name's script goes on the name, before the invisible "apply": \sin^2 x.
    const APPLY = '<mo>&#x2061;</mo>';
    if ((sub !== null || sup !== null) && base.endsWith(APPLY)) {
      return this.attach(base.slice(0, -APPLY.length), sub, sup) + APPLY;
    }
    return this.attach(base, sub, sup);
  }

  attach(base, sub, sup) {
    const large = base.startsWith('<mo largeop') || /<mo[^>]*>(∑|∏)<\/mo>/.test(base);
    const under = this.display && /<mo[^>]*>(∑|∏)<\/mo>|<mi>lim<\/mi>/.test(base);
    if (sub !== null && sup !== null) return under ? `<munderover>${base}${sub}${sup}</munderover>` : `<msubsup>${base}${sub}${sup}</msubsup>`;
    if (sub !== null) return under ? `<munder>${base}${sub}</munder>` : `<msub>${base}${sub}</msub>`;
    if (sup !== null) return under && !large ? `<mover>${base}${sup}</mover>` : `<msup>${base}${sup}</msup>`;
    return base;
  }

  atom() {
    const tk = this.next();
    if (tk.num !== undefined) return `<mn>${tk.num}</mn>`;
    if (tk.ch !== undefined) {
      const c = tk.ch;
      if (c === '{') {
        const s = this.sequence();
        if (this.peek() && this.peek().ch === '}') this.next();
        return `<mrow>${s}</mrow>`;
      }
      if (/[A-Za-z]/.test(c)) return `<mi>${c}</mi>`;
      if (c === '-') return '<mo>−</mo>';
      if (c === '*') return '<mo>∗</mo>';
      if ('()[]|'.includes(c)) return `<mo stretchy="false">${c}</mo>`;
      if (c === '~') return '<mspace width="0.25em"></mspace>';
      return `<mo>${esc(c)}</mo>`;
    }
    const cmd = tk.cmd;
    if (SYMBOLS[cmd]) {
      const v = SYMBOLS[cmd];
      return v.length > 1 ? `<mi mathvariant="normal">${v}</mi>` : `<mi>${v}</mi>`;
    }
    if (OPERATORS[cmd]) {
      const v = OPERATORS[cmd];
      return LARGE.has(v) ? `<mo largeop="true">${v}</mo>` : `<mo>${v}</mo>`;
    }
    if (FUNCTIONS.has(cmd)) return `<mi>${cmd}</mi><mo>&#x2061;</mo>`;
    if (SPACES[cmd]) return `<mspace width="${SPACES[cmd]}"></mspace>`;
    if (cmd === '{' || cmd === '}') return `<mo>${cmd}</mo>`;
    if ('%$&#_'.includes(cmd)) return `<mo>${esc(cmd)}</mo>`;
    if (cmd === '\\') return '<mspace linebreak="newline"></mspace>';
    if (cmd === 'frac' || cmd === 'dfrac' || cmd === 'tfrac') {
      const a = this.argument(), b = this.argument();
      const style = cmd === 'dfrac' ? ' displaystyle="true"' : cmd === 'tfrac' ? ' displaystyle="false"' : '';
      return `<mfrac${style}>${a}${b}</mfrac>`;
    }
    if (cmd === 'sqrt') {
      if (this.peek() && this.peek().ch === '[') {
        this.next();
        const idx = [];
        while (!this.atEnd() && this.peek().ch !== ']') idx.push(this.scripted());
        this.next();
        return `<mroot>${this.argument()}<mrow>${idx.join('')}</mrow></mroot>`;
      }
      return `<msqrt>${this.argument()}</msqrt>`;
    }
    if (ACCENTS[cmd]) return `<mover accent="true">${this.argument()}<mo>${ACCENTS[cmd]}</mo></mover>`;
    if (TEXTUAL.has(cmd)) {
      const s = tk.raw ?? this.rawArgument();
      // Spaces at the ends of a text would be trimmed: they are made non-breaking.
      const t = esc(s).replace(/^ +| +$/g, (m) => '\u00a0'.repeat(m.length));
      return cmd === 'text' || cmd === 'textrm' ? `<mtext>${t}</mtext>` : `<mi mathvariant="normal">${t}</mi>`;
    }
    if (cmd === 'mathbf' || cmd === 'boldsymbol') return `<mrow mathvariant="bold">${this.argument().replace(/<mi>/g, '<mi mathvariant="bold-italic">')}</mrow>`;
    if (cmd === 'mathcal') return this.argument().replace(/<mi>/g, '<mi mathvariant="script">');
    if (cmd === 'left' || cmd === 'right') {
      const d = this.delimiter();
      if (cmd === 'right') return d; // a stray \right
      const inner = this.sequence(true);
      let close = '';
      if (this.peek() && this.peek().cmd === 'right') { this.next(); close = this.delimiter(); }
      // \right]_{t_r}: the script goes on the closing bracket, which still stretches with the
      // row (a script on the whole row would stop the brackets stretching).
      let sub = null, sup = null;
      for (let tk = this.peek(); close && tk && ((tk.ch === '_' && sub === null) || (tk.ch === '^' && sup === null)); tk = this.peek()) {
        this.next();
        if (tk.ch === '_') sub = this.argument(); else sup = this.argument();
      }
      if (sub !== null || sup !== null) close = this.attach(close, sub, sup);
      return `<mrow>${d.replace('stretchy="false"', 'stretchy="true"')}${inner}${close.replace('stretchy="false"', 'stretchy="true"')}</mrow>`;
    }
    if (['big', 'Big', 'bigg', 'Bigg', 'displaystyle', 'limits', 'nolimits'].includes(cmd)) return '';
    return `<merror><mtext>\\${esc(cmd)}</mtext></merror>`;
  }

  delimiter() {
    const tk = this.next();
    if (!tk) return '';
    if (tk.ch === '.') return '';
    if (tk.ch) return `<mo stretchy="true">${esc(tk.ch === '-' ? '−' : tk.ch)}</mo>`;
    const v = OPERATORS[tk.cmd] || (tk.cmd === '{' || tk.cmd === '}' ? tk.cmd : '');
    return v ? `<mo stretchy="true">${v}</mo>` : '';
  }
}

/** TeX source to a <math> element's markup. */
export function texToMathML(tex, display = false) {
  const p = new Parser(tokenize(tex), display);
  let body = '';
  while (!p.atEnd()) {
    body += p.sequence();
    if (!p.atEnd()) p.next(); // an unmatched }
  }
  return `<math${display ? ' display="block"' : ''}>${body}</math>`;
}

/**
 * Replace $...$ (inline) and $$...$$ (display) in the text of an element and its descendants
 * with MathML.  A literal dollar sign is written \$.
 */
export function renderMath(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.nodeValue.includes('$') && !n.parentElement.closest('script, style, code, pre, textarea, math')
      ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
  });
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const node of nodes) {
    const src = node.nodeValue;
    const re = /\$\$([\s\S]+?)\$\$|\$((?:\\\$|[^$])+?)\$/g;
    let html = '', last = 0, m;
    while ((m = re.exec(src))) {
      if (m.index > 0 && src[m.index - 1] === '\\') continue;
      html += esc(src.slice(last, m.index).replace(/\\\$/g, '$'));
      html += m[1] !== undefined ? texToMathML(m[1].trim(), true) : texToMathML(m[2].trim(), false);
      last = re.lastIndex;
    }
    if (!html) continue;
    html += esc(src.slice(last).replace(/\\\$/g, '$'));
    const span = document.createElement('span');
    span.innerHTML = html;
    node.replaceWith(...span.childNodes);
  }
}
