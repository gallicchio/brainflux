import { test, assert } from './harness.js';
import { fixedNum, FIGURE_SPACE, numSlot, setSlots, setGroups } from '../lib/ui.js';
import { fillSlots, slotsWidth } from '../lib/plot.js';

const eq = (got, want) => assert(got === want, `expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);

test('fixedNum: fixed decimals, a true minus, no negative zero', () => {
  eq(fixedNum(1.25, 3), '1.250');
  eq(fixedNum(-1.25, 3), '−1.250');
  eq(fixedNum(-0.0004, 3), '0.000');
  eq(fixedNum(0.0004, 3, 8, { plus: '+' }), '+0.000');
  eq(fixedNum(2, 0), '2');
  eq(fixedNum(-2.5, 0), '−3');
  eq(fixedNum(NaN, 2), '–');
  eq(fixedNum(Infinity, 2), '∞');
  eq(fixedNum(-Infinity, 2), '−∞');
});

test('fixedNum: powers of ten only when the fixed form would overflow its width', () => {
  eq(fixedNum(123.456, 2, 7), '123.46');
  eq(fixedNum(-123.456, 2, 7), '−123.46');
  eq(fixedNum(123456.7, 2, 7), '1.23e5');
  eq(fixedNum(-123456.7, 2, 7), '−1.23e5');
  eq(fixedNum(1.5e-9, 2, 7), '0.00');            // small values round to zero, as fixed decimals do
  eq(fixedNum(6.02e23, 3, 8), '6.020e23');
  eq(fixedNum(6.02e23, 3, 6), '6.0e23');
  for (const v of [0, 1, -1, 9.999, -99.99, 1234.5, -98765.4, 1e12, -3e-3])
    assert(fixedNum(v, 2, 8).length <= 8, `${v} -> ${fixedNum(v, 2, 8)} fits in 8`);
});

test('fixedNum: tiny values in powers of ten, for quantities that span decades', () => {
  eq(fixedNum(1.818e-5, 3, 7, { tiny: true }), '1.82e−5');
  eq(fixedNum(-1.818e-5, 3, 8, { tiny: true }), '−1.82e−5');
  eq(fixedNum(0.25, 3, 7, { tiny: true }), '0.250');
  eq(fixedNum(0, 3, 7, { tiny: true }), '0.000');
  eq(fixedNum(2909.1, 3, 7, { tiny: true }), '2.909e3');
  eq(fixedNum(1.818e-5, 3, 7), '0.000');
});

test('fixedNum: the same length for any sign with plus and pad', () => {
  const lens = [3.21, -3.21, 0, -0.001].map((v) => fixedNum(v, 2, 6, { plus: FIGURE_SPACE, pad: true }).length);
  assert(lens.every((n) => n === 6), `lengths ${lens}`);
  eq(fixedNum(3.21, 2, 6, { plus: FIGURE_SPACE, pad: true }), `${FIGURE_SPACE}${FIGURE_SPACE}3.21`.padStart(6, FIGURE_SPACE));
  eq(fixedNum(-3.21, 2, 6, { pad: true }), `${FIGURE_SPACE}${FIGURE_SPACE}−3.21`.slice(-6));
});

test('setSlots: numbers in fixed slots; the words and slots stay put as the numbers change', () => {
  const box = document.createElement('div');
  box.style.cssText = 'position: absolute; left: 0; top: 0; font: 14px system-ui, sans-serif; white-space: nowrap';
  const css = document.createElement('style');
  css.textContent = '.fixnum { display: inline-block; text-align: right; white-space: pre; font-variant-numeric: tabular-nums; }';
  document.head.append(css);
  document.body.append(box);
  try {
    const show = (a, b) => setSlots(box, ['x = ', { v: a, dec: 3, w: 8 }, ' m, t = ', { v: b, dec: 1, w: 6 }, ' s']);
    show(1, 2);
    const slot = box.children[0], tail = box.lastChild;
    eq(slot.textContent, '1.000');
    eq(box.textContent, 'x = 1.000 m, t = 2.0 s');
    const range = document.createRange();
    const where = () => { range.selectNodeContents(tail); return range.getBoundingClientRect().left; };
    const x0 = where(), w0 = box.getBoundingClientRect().width;
    for (const [a, b] of [[-12.5, 1000], [0.0001, -3], [-1234.567, 99.9], [7, 0]]) {
      show(a, b);
      assert(box.children[0] === slot, 'the slot is kept when only the numbers change');
      assert(Math.abs(where() - x0) < 0.01 && Math.abs(box.getBoundingClientRect().width - w0) < 0.01,
        `the words after the numbers keep their place (${x0} -> ${where()}) for ${a}, ${b}`);
    }
    eq(box.children[0].textContent, '7.000');
    eq(box.children[1].textContent, '0.0');
    setSlots(box, ['y = ', { text: 'n/a', w: 4 }]);
    eq(box.textContent, 'y = n/a');
    box.textContent = '';                     // the content replaced from outside: built again
    setSlots(box, ['y = ', { text: 'n/a', w: 4 }]);
    eq(box.textContent, 'y = n/a');
    assert(numSlot(5).style.width === '5.5ch' && numSlot(5).classList.contains('fixnum'), 'numSlot: a fixnum 5.5ch wide');
  } finally { box.remove(); css.remove(); }
});

test('setSlots: a line that wraps never parts a number from the words touching it', () => {
  const box = document.createElement('div');
  box.style.cssText = 'position: absolute; left: 0; top: 0; font: 14px system-ui, sans-serif';
  const css = document.createElement('style');     // as in lib/style.css
  css.textContent = '.fixnum { display: inline-block; text-align: right; white-space: pre; } .nobr { white-space: nowrap; }';
  document.head.append(css);
  document.body.append(box);
  try {
    const range = document.createRange();
    const topOf = (w) => {
      const walk = document.createTreeWalker(box, NodeFilter.SHOW_TEXT);
      for (let n; (n = walk.nextNode());) {
        const i = n.data.indexOf(w);
        if (i >= 0) { range.setStart(n, i); range.setEnd(n, i + w.length); return range.getBoundingClientRect().top; }
      }
      return NaN;
    };
    let lines = new Set();
    for (let ch = 6; ch <= 40; ch++) {
      box.style.width = `${ch}ch`;
      setSlots(box, ['the screen at ±', { v: -12.5, dec: 2, w: 7 }, '\u00a0mm, its width ', { v: 3.25, dec: 3, w: 6 }, ' µm across']);
      const slots = box.querySelectorAll('.fixnum'), r = slots[0].getBoundingClientRect();
      lines.add(Math.round(box.getBoundingClientRect().height));
      const on = (w) => topOf(w) >= r.top - 1 && topOf(w) < r.bottom;
      assert(on('±') && on('mm,'), `${ch}ch: "±" and "mm," on the first number's line (${topOf('±')}, ${topOf('mm,')}; the number ${r.top} to ${r.bottom})`);
      assert(slots[0].parentNode.className === 'nobr' && slots[1].parentNode.className === 'nobr', 'each number in a span.nobr');
      assert(box.textContent === 'the screen at ±−12.50\u00a0mm, its width 3.250 µm across', box.textContent);
    }
    assert(lines.size > 1, 'the line did wrap at some widths');
  } finally { box.remove(); css.remove(); }
});

test('setGroups: groups kept whole, joined by spaces; only the numbers change after the first time', () => {
  const box = document.createElement('div');
  document.body.append(box);
  try {
    const show = (v) => setGroups(box, ['the baseline', ['B = ', { v, dec: 3, w: 6 }, '\u00a0m'], ['(', { v: 2 * v, dec: 1, w: 5 }, ' fringes)']]);
    show(1.0644);
    eq(box.textContent, 'the baseline B = 1.064\u00a0m (2.1 fringes)');
    const spans = [...box.children];
    assert(spans.length === 2 && spans.every((g) => g.className === 'nobr'), 'two groups, each a span.nobr');
    show(-1.25);
    assert(box.children[0] === spans[0] && box.children[1] === spans[1], 'the groups are kept');
    eq(box.textContent, 'the baseline B = −1.250\u00a0m (−2.5 fringes)');
    box.innerHTML = '&nbsp;';
    show(2);
    eq(box.textContent, 'the baseline B = 2.000\u00a0m (4.0 fringes)');
  } finally { box.remove(); }
});

test('fillSlots: a canvas line is the same width, its words in the same places, for any numbers', () => {
  const ctx = document.createElement('canvas').getContext('2d');
  ctx.font = '12px system-ui, sans-serif';
  const calls = [];
  const fill = ctx.fillText.bind(ctx);
  ctx.fillText = (t, x, y) => { calls.push([t, x, ctx.textAlign]); fill(t, x, y); };
  const widths = [], words = [];
  for (const v of [1, -1, 12.345, -999.999, 0]) {
    for (const align of ['left', 'center', 'right']) {
      calls.length = 0;
      ctx.textAlign = align;
      widths.push(fillSlots(ctx, ['v = ', { v, dec: 2, w: 7 }, ' m/s'], 100, 20));
      eq(ctx.textAlign, align);
      words.push(calls.filter(([t]) => t === ' m/s').map(([, x]) => x)[0]);
    }
  }
  assert(widths.every((w) => w === widths[0]), `widths ${widths}`);
  assert(slotsWidth(ctx, ['v = ', { v: 3, dec: 2, w: 7 }, ' m/s']) === widths[0], 'slotsWidth: the same width, without drawing');
  for (let i = 0; i < 3; i++) {
    const xs = words.filter((_, k) => k % 3 === i);
    assert(xs.every((x) => Math.abs(x - xs[0]) < 1e-9), `the unit stays put (${xs})`);
  }
});
