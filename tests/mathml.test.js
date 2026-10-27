import { test, assert } from './harness.js';
import { texToMathML } from '../lib/mathml.js';

test('TeX to MathML: the common constructions', () => {
  const cases = [
    ['\\frac12', '<mfrac><mn>1</mn><mn>2</mn></mfrac>'],
    ['x^2', '<msup><mi>x</mi><mn>2</mn></msup>'],
    ['f(t)=\\sum_{n=1}^{N}A_n.', '</math>'],      // a full stop after a formula
    ['3.14', '<mn>3.14</mn>'],
    ['.5', '<mn>.5</mn>'],
    ['\\hbar\\omega', 'ℏ'],
    ['\\left(\\frac{a}{b}\\right)', 'stretchy="true"'],
    ['\\vec k\\cdot\\vec r', '<mover accent="true">'],
    ['\\text{and}', '<mtext>and</mtext>'],
    ['x\\text{ if } y', '<mtext> if </mtext>'],            // spaces in text are kept
    ['\\text{50\\% off}', '<mtext>50% off</mtext>'],
    ['50\\%', '<mo>%</mo>'],
    ['\\sin^2\\theta', '<msup><mi>sin</mi><mn>2</mn></msup><mo>&#x2061;</mo>'],   // the power on the name
    ['\\log_2 N', '<msub><mi>log</mi><mn>2</mn></msub><mo>&#x2061;</mo>'],
  ];
  for (const [tex, want] of cases) {
    const m = texToMathML(tex);
    assert(m.includes(want), `${tex} -> ${m}`);
    assert(!m.includes('merror'), `${tex} gave an error: ${m}`);
  }
});

test('every formula in every demo translates without an error', async () => {
  // ?page=name checks one demo's page, listed here or not.
  const one = new URLSearchParams(location.search).get('page');
  const pages = one ? [one] : ['fft2d', 'schrodinger1d', 'action', 'schrodinger2d', 'planewave', 'diffraction', 'fourier',
    'thinfilms', 'dispersion', 'interferometer', 'imaging', 'holography', 'tomography', 'arrays', 'beams', 'phasespace', 'radiation', 'maxwell2d'];
  let count = 0;
  for (const p of pages) {
    const html = await (await fetch(`../${p}/index.html`)).text();
    for (const m of html.matchAll(/\$\$([\s\S]+?)\$\$|\$((?:\\\$|[^$])+?)\$/g)) {
      const tex = (m[1] ?? m[2]).trim(), out = texToMathML(tex, !!m[1]);
      assert(!out.includes('merror'), `${p}: ${tex} -> ${out}`);
      count++;
    }
  }
  return `${count} formulas`;
});
