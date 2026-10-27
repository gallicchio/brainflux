// Numbers for read-outs that must not jiggle: every value of a quantity is written in the same
// number of characters, right-aligned, with fixed decimals, so that (in a monospace font, in a
// slot of fixed width) nothing moves as the value changes.  No DOM.

/**
 * v with `decimals` decimals, padded on the left to exactly `width` characters.
 *   signed: keep a place for the sign (a space for + or 0, '−' for −), so that the digits
 *           stay put when the value crosses zero.
 * A value too big for the slot is written in exponent form (1.23e8), with as many digits as
 * fit; one that is not finite is a dash.
 */
export function fixed(v, decimals, width, signed = false) {
  if (!Number.isFinite(v)) return '—'.padStart(width);
  const a = Math.abs(v);
  let body = a.toFixed(decimals);
  const neg = v < 0 && Number(body) !== 0;   // no "−0.000"
  const room = width - (signed || neg ? 1 : 0);
  if (body.length > room) {
    for (let p = Math.max(0, room - 4); p >= 0; p--) {
      body = a.toExponential(p).replace('e+', 'e');
      if (body.length <= room) break;
    }
  }
  const sign = neg ? '−' : signed ? ' ' : '';
  return (sign + body).padStart(width);
}
