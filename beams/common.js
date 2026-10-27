// Small helpers shared by the three views of the beams demo: length formatting, the colour of a
// wavelength, colour tables for drawing fields fast, a slider for signed quantities (focal
// lengths, mirror radii) and a few canvas shapes.

import { el, slider, segmented, fmt, setSlots } from '../lib/ui.js';
import { fillSlots } from '../lib/plot.js';
import { colorOf } from '../lib/complexcolor.js';

/** A length in mm, written in um, mm or m as suits it. */
export function fmtLen(mm, digits = 3) {
  if (!Number.isFinite(mm)) return mm > 0 ? '∞' : mm < 0 ? '−∞' : '—';
  if (mm === 0) return '0 mm';
  const a = Math.abs(mm), s = (v) => fmt(v, digits).replace('-', '−');
  if (a < 1) return `${s(mm * 1000)} µm`;
  if (a >= 1000) return `${s(mm / 1000)} m`;
  return `${s(mm)} mm`;
}

/** An angle in radians, written in urad or mrad (or degrees if large). */
export function fmtAngle(rad, digits = 3) {
  const a = Math.abs(rad);
  if (a >= 0.1) return `${fmt((rad * 180) / Math.PI, digits)}°`;
  if (a < 1e-3) return `${fmt(rad * 1e6, digits)} µrad`;
  return `${fmt(rad * 1e3, digits)} mrad`;
}

/** A frequency in Hz, in kHz, MHz or GHz. */
export function fmtFreq(hz, digits = 3) {
  const a = Math.abs(hz);
  if (a >= 1e9) return `${fmt(hz / 1e9, digits)} GHz`;
  if (a >= 1e6) return `${fmt(hz / 1e6, digits)} MHz`;
  if (a >= 1e3) return `${fmt(hz / 1e3, digits)} kHz`;
  return `${fmt(hz, digits)} Hz`;
}

/** A phase in units of pi. */
export const fmtPi = (rad, digits = 3) => `${fmt(rad / Math.PI, digits).replace('-', '−')}π`;

// The same quantities for live read-outs, as parts for setSlots (lib/ui.js) or fillSlots
// (lib/plot.js): the number in a slot w characters wide with a fixed number of decimals for its
// unit, then the unit (after a no-break space).  A change of unit is a change of words; within
// one unit, nothing moves as the number changes.

/** A length in mm, in um (1 decimal), mm (2) or m (2); dec overrides the decimals per unit
 *  ({ um: 3 } for a wavelength, say). */
export function lenParts(mm, w = 7, dec = {}) {
  if (!Number.isFinite(mm)) return [{ text: mm > 0 ? '∞' : mm < 0 ? '−∞' : '—', w }];
  const a = Math.abs(mm), d = { um: 1, mm: 2, m: 2, ...dec };
  if (a < 1 && a > 0) return [{ v: mm * 1000, dec: d.um, w }, ' µm'];
  if (a >= 1000) return [{ v: mm / 1000, dec: d.m, w }, ' m'];
  return [{ v: mm, dec: d.mm, w }, ' mm'];
}

/** An angle in radians: degrees (2 decimals), mrad (2) or urad (1). */
export function angleParts(rad, w = 6) {
  const a = Math.abs(rad);
  if (a >= 0.1) return [{ v: (rad * 180) / Math.PI, dec: 2, w }, '°'];
  if (a < 1e-3) return [{ v: rad * 1e6, dec: 1, w }, ' µrad'];
  return [{ v: rad * 1e3, dec: 2, w }, ' mrad'];
}

/** A frequency in Hz, in kHz, MHz (1 decimal) or GHz (2). */
export function freqParts(hz, w = 6) {
  const a = Math.abs(hz);
  if (a >= 1e9) return [{ v: hz / 1e9, dec: 2, w }, ' GHz'];
  if (a >= 1e6) return [{ v: hz / 1e6, dec: 1, w }, ' MHz'];
  if (a >= 1e3) return [{ v: hz / 1e3, dec: 1, w }, ' kHz'];
  return [{ v: hz, dec: 1, w }, ' Hz'];
}

/** A phase in units of pi, dec decimals, in a slot w wide (room for a sign and one digit). */
export const piParts = (rad, dec = 3, w = dec + 3) => [{ v: rad / Math.PI, dec, w }, 'π'];

/** fillSlots with a dark halo (as haloText), readable over a field picture. */
export function haloSlots(ctx, parts, x, y, color = '#fff') {
  ctx.save();
  ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.75)'; ctx.lineJoin = 'round'; ctx.fillStyle = color;
  const pen = {
    measureText: (s) => ctx.measureText(s),
    fillText: (s, px, py) => { ctx.strokeText(s, px, py); ctx.fillText(s, px, py); },
    get textAlign() { return ctx.textAlign; },
    set textAlign(v) { ctx.textAlign = v; },
  };
  fillSlots(pen, parts, x, y);
  ctx.restore();
}

/** An approximate colour [r, g, b] (0..1) for a wavelength in nm (after Dan Bruton); infrared
 *  and ultraviolet get a dim red and a dim violet, so the beam stays visible. */
export function wavelengthRGB(nm) {
  const w = Math.max(380, Math.min(780, nm));
  let r = 0, g = 0, b = 0;
  if (w < 440) { r = -(w - 440) / 60; b = 1; } else if (w < 490) { g = (w - 440) / 50; b = 1; }
  else if (w < 510) { g = 1; b = -(w - 510) / 20; } else if (w < 580) { r = (w - 510) / 70; g = 1; }
  else if (w < 645) { r = 1; g = -(w - 645) / 65; } else r = 1;
  const f = w < 420 ? 0.3 + (0.7 * (w - 380)) / 40 : w > 700 ? 0.3 + (0.7 * (780 - w)) / 80 : 1;
  const k = Math.max(f, 0.55);
  return [r * k, g * k, b * k];
}

/**
 * A colour table for signed real values in [-vmax, vmax], with the colours of the complex
 * colour wheel (positive red, negative cyan, brightness by |v| with R at half lightness).
 * Returns { lut: Uint8ClampedArray(4 * size), size, vmax }.
 */
export function realTable(R, size = 1024) {
  const vmax = 6 * R, lut = new Uint8ClampedArray(4 * size);
  for (let k = 0; k < size; k++) {
    const v = ((k + 0.5) / size - 0.5) * 2 * vmax;
    const [r, g, b] = colorOf(v, 0, R);
    lut[4 * k] = r; lut[4 * k + 1] = g; lut[4 * k + 2] = b; lut[4 * k + 3] = 255;
  }
  return { lut, size, vmax };
}

/** A colour table for intensities in [0, imax]: black through the laser's colour to white. */
export function intensityTable(rgb, Iref, size = 1024) {
  const imax = 12 * Iref, lut = new Uint8ClampedArray(4 * size);
  for (let k = 0; k < size; k++) {
    const I = ((k + 0.5) / size) * imax;
    const t = (2 / Math.PI) * Math.atan(I / Iref);      // 0..1, 1/2 at Iref
    const u = Math.min(1, t / 0.62), white = Math.max(0, (t - 0.62) / 0.38);
    for (let c = 0; c < 3; c++) lut[4 * k + c] = 255 * Math.min(1, rgb[c] * u + white * (1 - rgb[c] * u));
    lut[4 * k + 3] = 255;
  }
  return { lut, size, imax };
}

/**
 * A slider for a signed length that may also be infinite (a focal length, a mirror radius):
 * a row of buttons for the sign (and "flat"), and a logarithmic slider for the size.
 *   opts: label, min, max (of |value|), value, signs: [{value: 1, label}, {value: -1, label},
 *         {value: 0, label: 'flat'}], onInput(value)
 * The value is signed, or Infinity for "flat".  Returns the element with .value (get/set).
 */
export function signedSlider(opts) {
  const signs = opts.signs;
  let value = opts.value;
  const signOf = (v) => (!Number.isFinite(v) ? 0 : v < 0 ? -1 : 1);
  const mag = slider({
    label: opts.label, labelHTML: opts.labelHTML, min: opts.min, max: opts.max, log: true,
    value: Number.isFinite(value) ? Math.abs(value) : opts.min * 10, title: opts.title,
    onInput: (v) => { const s = signOf(value) || 1; value = s * v; seg.value = s; mag.hidden = false; opts.onInput?.(value); },
  });
  const seg = segmented(signs.map((s) => ({ value: s.value, label: s.label, title: s.title })), signOf(value), (s) => {
    if (s === 0) { value = Infinity; mag.hidden = true; }
    else { value = s * mag.value; mag.hidden = false; }
    opts.onInput?.(value);
  }, { label: opts.label });
  seg.classList.add('sign-seg');
  const wrap = el('div', { class: 'signed' }, seg, mag);
  mag.hidden = !Number.isFinite(value);
  Object.defineProperty(wrap, 'value', {
    get: () => value,
    set: (v) => {
      value = v; seg.value = signOf(v);
      mag.hidden = !Number.isFinite(v);
      if (Number.isFinite(v)) mag.value = Math.abs(v);
    },
  });
  return wrap;
}

/** A line with an arrowhead at (x1, y1). */
export function arrow(ctx, x0, y0, x1, y1, head = 7) {
  const a = Math.atan2(y1 - y0, x1 - x0);
  ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x1 - head * Math.cos(a - 0.4), y1 - head * Math.sin(a - 0.4));
  ctx.lineTo(x1 - head * Math.cos(a + 0.4), y1 - head * Math.sin(a + 0.4));
  ctx.closePath(); ctx.fill();
}

/**
 * The points of a circular arc drawn as a wavefront or a mirror: on the axis at pixel (X0, yc),
 * radius Rpx pixels (positive: the centre of curvature to the left), from height -h to h px.
 * Calls ctx.moveTo/lineTo; the caller strokes.
 */
export function arcPath(ctx, X0, yc, Rpx, h) {
  const steps = 24;
  if (!Number.isFinite(Rpx) || Math.abs(Rpx) > 1e7) { ctx.moveTo(X0, yc - h); ctx.lineTo(X0, yc + h); return; }
  const lim = Math.min(h, Math.abs(Rpx) * 0.995);
  for (let k = 0; k <= steps; k++) {
    const y = -lim + (2 * lim * k) / steps;
    const sag = Math.abs(Rpx) - Math.sqrt(Rpx * Rpx - y * y);
    const x = X0 - Math.sign(Rpx) * sag;
    if (k === 0) ctx.moveTo(x, yc + y); else ctx.lineTo(x, yc + y);
  }
}

/** Text with a dark halo, readable over a field picture. */
export function haloText(ctx, text, x, y, color = '#fff') {
  ctx.save();
  ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.75)'; ctx.lineJoin = 'round';
  ctx.strokeText(text, x, y);
  ctx.fillStyle = color; ctx.fillText(text, x, y);
  ctx.restore();
}
