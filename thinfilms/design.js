// Two small pieces of the interface that are easier to test on their own: the coating
// designer's shorthand, and the thickness of a draining soap film.

/**
 * The thin-film designer's notation (Macleod, Thin-Film Optical Filters): H and L are
 * quarter-wave layers of a high- and a low-index material at the design wavelength (optical
 * thickness n d = lambda0 / 4), M a third material; a number in front multiplies the thickness
 * (2L is a half-wave layer); (...)^N repeats.  So "(HL)^5 H" is an eleven-layer Bragg mirror and
 * "(HL)^4 2H (LH)^4" a Fabry-Perot filter.  An exponent may be a name (N), which the page makes
 * into a slider: its value comes from params.
 *
 * parseDesign(text) -> { items, names } or throws Error with .pos; expandDesign(items, params)
 * -> [{ m: 'H' | 'L' | 'M', q: quarter waves }], with neighbours of the same material merged
 * (two touching L layers are one thicker layer).
 */
export function parseDesign(text) {
  const src = String(text);
  let i = 0;
  const names = new Set();
  const fail = (msg) => { const e = new Error(msg); e.pos = i; throw e; };
  const space = () => { while (i < src.length && /\s/.test(src[i])) i++; };
  const number = () => {
    const m = /^(\d+\.?\d*|\.\d+)/.exec(src.slice(i));
    if (!m) return null;
    i += m[0].length;
    return parseFloat(m[0]);
  };
  function sequence(inGroup) {
    const items = [];
    for (;;) {
      space();
      if (i >= src.length) { if (inGroup) fail('a ( is not closed'); break; }
      if (src[i] === ')') { if (!inGroup) fail('a ) without a ('); break; }
      const mult = number();
      space();
      let item;
      if (src[i] === '(') {
        if (mult !== null) fail('to repeat a group write (…)^n');
        i++;
        const inner = sequence(true);
        i++; // the )
        item = { group: inner };
      } else if (/[HLMhlm]/.test(src[i] || '')) {
        item = { m: src[i].toUpperCase(), q: mult ?? 1 };
        i++;
      } else fail(src[i] === undefined ? 'unfinished' : `"${src[i]}" is not H, L, M or a bracket`);
      space();
      if (src[i] === '^') {
        i++; space();
        const n = number();
        if (n !== null) { if (!Number.isInteger(n)) fail('repeat a whole number of times'); item.rep = n; }
        else {
          const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i));
          if (!m) fail('^ needs a number or a name');
          i += m[0].length;
          item.rep = m[0]; names.add(m[0]);
        }
      }
      items.push(item);
    }
    return items;
  }
  const items = sequence(false);
  if (!items.length) { i = 0; fail('empty: try (HL)^N H'); }
  return { items, names: [...names] };
}

export function expandDesign(items, params = {}, limit = 400) {
  const out = [];
  const push = (m, q) => {
    if (q <= 0) return;
    const last = out[out.length - 1];
    if (last && last.m === m) last.q += q; else out.push({ m, q });
    if (out.length > limit) throw new Error(`more than ${limit} layers`);
  };
  const walk = (list) => {
    for (const it of list) {
      let n = it.rep === undefined ? 1 : typeof it.rep === 'number' ? it.rep : Math.round(params[it.rep] ?? 1);
      n = Math.max(0, n);
      for (let k = 0; k < n; k++) {
        if (it.group) walk(it.group); else push(it.m, it.q);
      }
    }
  };
  walk(items);
  return out;
}

/**
 * The thickness (nm) of a vertical soap film at fractional depth y (0 at the top, 1 at the
 * bottom of the frame).  A film draining under gravity thickens downwards as the square root of
 * the depth (the similarity solution of the thin-film drainage equation: the flux down the
 * film goes as h^3, so h ~ (y/t)^(1/2)); hBottom sets the scale.  Where the film would be thinner
 * than hCrit it has become a black film of thickness hBlack, held apart only by the forces
 * between the two soap layers (a "common black film" is about 30 nm, a "Newton black film" 4-5
 * nm), with a sharp border, as real films show.
 */
export function drainingThickness(y, hBottom, { hBlack = 10, hCrit = 25 } = {}) {
  const h = hBottom * Math.sqrt(Math.max(0, y));
  return h < hCrit ? hBlack : h;
}
