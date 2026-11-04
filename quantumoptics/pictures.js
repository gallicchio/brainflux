// The sketches: how squeezed light is made (the crystal pumped at 2ω and a loss), the homodyne
// detector, and LIGO with its squeezer at the dark port.  Each draws into a context sized
// (w, h) in CSS pixels; the small quadrature-plane icons show the state at each point.

import { principalSpreads } from './states.js';

const F = '12px system-ui, sans-serif', FS = '11px system-ui, sans-serif';

/** A small quadrature plane with the state's 1σ ellipse: half-side s px, 1 unit = s/3 px. */
export function cloudIcon(ctx, cx, cy, s, st, c, { fill = c.cloud, label = '', scale = 0 } = {}) {
  // 1 unit = k px: the whole cloud (mean and two spreads) fits the square, the vacuum fills a good part of it.
  const sp = principalSpreads(st), k = scale || s / Math.max(1.6, Math.hypot(st.x1, st.x2) + 2.2 * sp.max);
  ctx.save();
  ctx.strokeStyle = c.line; ctx.lineWidth = 1; ctx.fillStyle = c.panel;
  ctx.fillRect(cx - s, cy - s, 2 * s, 2 * s); ctx.strokeRect(cx - s + 0.5, cy - s + 0.5, 2 * s - 1, 2 * s - 1);
  ctx.strokeStyle = c.ink3; ctx.setLineDash([2, 3]);
  ctx.beginPath(); ctx.moveTo(cx - s, cy + 0.5); ctx.lineTo(cx + s, cy + 0.5); ctx.moveTo(cx + 0.5, cy - s); ctx.lineTo(cx + 0.5, cy + s); ctx.stroke();
  ctx.setLineDash([]);
  ctx.beginPath(); ctx.rect(cx - s, cy - s, 2 * s, 2 * s); ctx.clip();
  for (const [m, a] of [[2, 0.25], [1, 0.75]]) {
    ctx.save();
    ctx.translate(cx + st.x1 * k, cy - st.x2 * k);
    ctx.rotate(-sp.angle);
    ctx.scale(Math.max(0.3, m * sp.min * k), Math.max(0.3, m * sp.max * k));
    ctx.beginPath(); ctx.arc(0, 0, 1, 0, 2 * Math.PI);
    ctx.restore();
    ctx.globalAlpha = a; ctx.fillStyle = fill; ctx.fill(); ctx.globalAlpha = 1;
  }
  if (st.x1 || st.x2) {
    ctx.strokeStyle = c.ink; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + st.x1 * k, cy - st.x2 * k); ctx.stroke();
    ctx.fillStyle = c.ink; ctx.beginPath(); ctx.arc(cx + st.x1 * k, cy - st.x2 * k, 2.2, 0, 2 * Math.PI); ctx.fill();
  }
  ctx.restore();
  if (label) { ctx.save(); ctx.fillStyle = c.ink2; ctx.font = FS; ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.fillText(label, cx, cy + s + 3); ctx.restore(); }
}

function arrow(ctx, x0, y0, x1, y1, color, width = 2, head = 7, dash = []) {
  const a = Math.atan2(y1 - y0, x1 - x0);
  ctx.save();
  ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = width; ctx.setLineDash(dash);
  ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1 - head * 0.6 * Math.cos(a), y1 - head * 0.6 * Math.sin(a)); ctx.stroke();
  ctx.setLineDash([]);
  ctx.beginPath(); ctx.moveTo(x1, y1);
  ctx.lineTo(x1 - head * Math.cos(a - 0.45), y1 - head * Math.sin(a - 0.45));
  ctx.lineTo(x1 - head * Math.cos(a + 0.45), y1 - head * Math.sin(a + 0.45));
  ctx.closePath(); ctx.fill();
  ctx.restore();
}

function text(ctx, s, x, y, c, { align = 'center', base = 'top', font = FS, color = c.ink2 } = {}) {
  ctx.save(); ctx.font = font; ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = base; ctx.fillText(s, x, y); ctx.restore();
}

function box(ctx, x, y, w, h, c, fill, stroke) {
  ctx.save(); ctx.fillStyle = fill; ctx.strokeStyle = stroke; ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.rect(x, y, w, h); ctx.fill(); ctx.stroke(); ctx.restore();
}

/**
 * The squeezer: input state → crystal pumped at 2ω → squeezed state → loss → what is left.
 * p: {input (state before), squeezed (after the crystal, no loss), out (after loss), r, dB, eta, isVacuum}
 */
export function drawSqueezer(ctx, w, h, p, c) {
  ctx.clearRect(0, 0, w, h);
  const y = h * 0.5 + 4, s = Math.min(32, h * 0.24);
  const xs = [0.08, 0.36, 0.58, 0.76, 0.93].map((f) => f * w);
  const spS = principalSpreads(p.squeezed), scale = s / Math.max(1.6, Math.hypot(p.squeezed.x1, p.squeezed.x2) + 2.2 * spS.max);
  // The beam.
  ctx.save(); ctx.strokeStyle = c.signal; ctx.lineWidth = 2; ctx.globalAlpha = 0.5;
  ctx.beginPath(); ctx.moveTo(xs[0] + s, y); ctx.lineTo(xs[4] - s, y); ctx.stroke(); ctx.restore();
  arrow(ctx, xs[0] + s + 2, y, xs[1] - 30, y, c.signal, 2);
  arrow(ctx, xs[1] + 30, y, xs[2] - s - 2, y, c.signal, 2);
  arrow(ctx, xs[2] + s + 2, y, xs[3] - 16, y, c.signal, 2);
  arrow(ctx, xs[3] + 16, y, xs[4] - s - 2, y, c.signal, 2);
  // In.
  cloudIcon(ctx, xs[0], y, s, p.input, c, { label: p.isVacuum ? 'in: the vacuum' : 'in: a laser\'s field', scale });
  // The crystal: a prism with the pump coming down into it.
  const cw = 56, ch = 26;
  ctx.save();
  ctx.fillStyle = c.crystal; ctx.strokeStyle = c.ink2; ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.moveTo(xs[1] - cw / 2, y - ch / 2); ctx.lineTo(xs[1] + cw / 2 - 8, y - ch / 2); ctx.lineTo(xs[1] + cw / 2, y + ch / 2); ctx.lineTo(xs[1] - cw / 2 + 8, y + ch / 2); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.restore();
  text(ctx, 'χ⁽²⁾ crystal', xs[1], y + ch / 2 + 4, c);
  text(ctx, p.r > 0 ? `r = ${p.r.toFixed(2)}  (${p.dB.toFixed(1)} dB)` : 'not pumped: r = 0', xs[1], y + ch / 2 + 17, c, { color: c.ink });
  arrow(ctx, xs[1] - 46, 8, xs[1] - 6, y - ch / 2 - 2, c.pump, 2.5, 8);
  text(ctx, 'pump at 2ω', xs[1] - 44, 6, c, { align: 'right', color: c.pump, font: F });
  // Out of the crystal.
  cloudIcon(ctx, xs[2], y, s, p.squeezed, c, { label: p.r > 0 ? 'out: squeezed' : 'out: unchanged', scale });
  // Loss: a beam splitter in a grey box, light leaving downwards and the vacuum coming in.
  box(ctx, xs[3] - 16, y - 16, 32, 32, c, c.lossFill, c.ink3);
  ctx.save(); ctx.strokeStyle = c.ink2; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(xs[3] - 11, y + 11); ctx.lineTo(xs[3] + 11, y - 11); ctx.stroke(); ctx.restore();
  text(ctx, 'loss', xs[3] - 20, y - 14, c, { align: 'right', base: 'bottom', color: c.ink });
  if (p.eta < 1) {
    arrow(ctx, xs[3], y + 16, xs[3], y + 16 + Math.min(30, h * 0.2), c.signal, 1.5, 6);
    text(ctx, `${Math.round(100 * (1 - p.eta))}% escapes`, xs[3] + 4, y + 20 + Math.min(30, h * 0.2) * 0.55, c, { align: 'left', base: 'middle' });
    arrow(ctx, xs[3], y - 16 - Math.min(26, h * 0.18), xs[3], y - 17, c.ink3, 1.5, 6, [3, 3]);
    text(ctx, 'vacuum in', xs[3] + 4, y - 18 - Math.min(26, h * 0.18) * 0.5, c, { align: 'left', base: 'middle' });
  } else text(ctx, 'none', xs[3], y + 20, c);
  cloudIcon(ctx, xs[4], y, s, p.out, c, { label: p.eta < 1 ? 'after the loss' : 'measured', scale });
}

/**
 * The homodyne detector.  p: {signal (state), theta (deg), lo: text for the LO's label, showShift}
 */
export function drawHomodyne(ctx, w, h, p, c) {
  ctx.clearRect(0, 0, w, h);
  const top = 26, bx = w * 0.5, by = top + (h - top) * 0.5, s = Math.min(34, h * 0.12);
  // Beams: the signal from the left, the LO from below; outputs to the right and up.
  const lw = 2.5;
  ctx.save(); ctx.globalAlpha = 0.9;
  arrow(ctx, w * 0.1 + s + 4, by, bx - 14, by, c.signal, lw, 8);
  arrow(ctx, bx, h * 0.95, bx, by + 14, c.lo, 4, 9);
  // After the beam splitter both outputs carry both beams: draw them two-coloured.
  arrow(ctx, bx + 14, by, w * 0.86, by, c.lo, 4, 9);
  arrow(ctx, bx + 14, by - 1.5, w * 0.86 - 4, by - 1.5, c.signal, 1.5, 0);
  arrow(ctx, bx, by - 14, bx, top + 14, c.lo, 4, 9);
  arrow(ctx, bx + 1.5, by - 14, bx + 1.5, top + 18, c.signal, 1.5, 0);
  ctx.restore();
  // The beam splitter: a square with its diagonal.
  ctx.save();
  ctx.translate(bx, by); ctx.rotate(Math.PI / 4);
  ctx.fillStyle = c.bsFill; ctx.strokeStyle = c.ink2; ctx.lineWidth = 1.2;
  ctx.fillRect(-11, -11, 22, 22); ctx.strokeRect(-11, -11, 22, 22);
  ctx.beginPath(); ctx.moveTo(-11, 0); ctx.lineTo(11, 0); ctx.stroke();
  ctx.restore();
  text(ctx, '50:50', bx + 16, by + 8, c, { align: 'left' });
  // The signal's cloud.
  cloudIcon(ctx, w * 0.1, by, s, p.signal, c, { label: 'signal' });
  text(ctx, 'signal a', w * 0.1 + s + 8, by - 6, c, { align: 'left', base: 'bottom', color: c.signal, font: F });
  // The LO with its phase shifter.
  const py = h * 0.78;
  box(ctx, bx - 14, py - 9, 28, 18, c, c.bsFill, c.ink2);
  text(ctx, 'phase θ', bx + 18, py, c, { align: 'left', base: 'middle' });
  text(ctx, `θ = ${Math.round(p.theta)}°`, bx + 18, py + 13, c, { align: 'left', base: 'middle', color: c.ink, font: F });
  text(ctx, 'local oscillator', bx - 18, h * 0.95, c, { align: 'right', base: 'bottom', color: c.lo, font: F });
  text(ctx, 'β = |β| e^{iθ}, strong', bx - 18, h * 0.95 - 14, c, { align: 'right', base: 'bottom' });
  // The dial on the phase shifter.
  ctx.save(); ctx.strokeStyle = c.lo; ctx.lineWidth = 2; const th = (p.theta * Math.PI) / 180;
  ctx.beginPath(); ctx.moveTo(bx, py); ctx.lineTo(bx + 7 * Math.cos(th), py - 7 * Math.sin(th)); ctx.stroke(); ctx.restore();
  // Photodiodes: half-disks facing the beams.
  const d1 = [w * 0.88, by], d2 = [bx, top + 11];
  for (const [x, yy, rot, name] of [[d1[0], d1[1], Math.PI / 2, 'D₁'], [d2[0], d2[1], Math.PI, 'D₂']]) {
    ctx.save(); ctx.translate(x, yy); ctx.rotate(rot);
    ctx.fillStyle = c.ink2; ctx.beginPath(); ctx.arc(0, 0, 11, 0, Math.PI); ctx.closePath(); ctx.fill();
    ctx.restore();
  }
  text(ctx, 'D₁', d1[0] + 14, d1[1], c, { align: 'left', base: 'middle', font: F });
  text(ctx, 'D₂', d2[0] - 16, d2[1], c, { align: 'right', base: 'middle', font: F });
  // The subtraction: wires from both diodes to a circle.
  const sx = w * 0.88, sy = top + 11;
  ctx.save(); ctx.strokeStyle = c.ink2; ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.moveTo(d1[0], d1[1] - 11); ctx.lineTo(d1[0], sy + 12); ctx.moveTo(d2[0] + 11, d2[1]); ctx.lineTo(sx - 12, sy); ctx.stroke();
  ctx.fillStyle = c.panel; ctx.beginPath(); ctx.arc(sx, sy, 11, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
  ctx.restore();
  text(ctx, '−', sx, sy + 0.5, c, { base: 'middle', font: '700 15px system-ui, sans-serif', color: c.ink });
  text(ctx, 'i₁ − i₂ ∝ |β| X_θ', sx - 16, sy + 18, c, { align: 'right', color: c.ink, font: F });
  text(ctx, 'to the strip chart', sx - 16, sy + 32, c, { align: 'right' });
}

/**
 * LIGO.  p: {P (W), sq: {on, dB, eta, fd}, inject (state icon: the vacuum or the squeezed vacuum), h (strain), dL, phase}
 */
export function drawLigo(ctx, w, h, p, c) {
  ctx.clearRect(0, 0, w, h);
  const compact = w < 640;          // a phone: fewer words
  const bx = w * (compact ? 0.42 : 0.38), by = h * 0.52;
  const xEnd = w * 0.95, yEnd = 30, yPd = h * 0.92;
  // The beams.
  ctx.save(); ctx.strokeStyle = c.signal; ctx.lineWidth = 2; ctx.globalAlpha = 0.75;
  ctx.beginPath(); ctx.moveTo(w * 0.07, by); ctx.lineTo(bx, by); ctx.stroke();
  ctx.lineWidth = 4;
  ctx.beginPath(); ctx.moveTo(w * 0.47, by); ctx.lineTo(xEnd, by); ctx.moveTo(bx, by - 24); ctx.lineTo(bx, yEnd); ctx.stroke();
  ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(w * 0.47, by); ctx.moveTo(bx, by); ctx.lineTo(bx, by - 24); ctx.stroke();
  ctx.restore();
  // The dark port, downwards to the photodiode.
  ctx.save(); ctx.strokeStyle = c.ink3; ctx.lineWidth = 1.5; ctx.setLineDash([4, 3]);
  ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx, yPd - 12); ctx.stroke(); ctx.restore();
  // Laser, power-recycling mirror.
  box(ctx, w * 0.02, by - 9, Math.max(22, w * 0.05), 18, c, c.bsFill, c.ink2);
  text(ctx, 'laser', w * 0.02 + Math.max(11, w * 0.025), by + 12, c);
  ctx.save(); ctx.strokeStyle = c.ink; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(w * 0.2, by - 12); ctx.lineTo(w * 0.2, by + 12); ctx.stroke(); ctx.restore();
  if (!compact) text(ctx, 'power recycling', w * 0.2, by - 15, c, { base: 'bottom' });
  // The beam splitter.
  ctx.save(); ctx.translate(bx, by); ctx.rotate(Math.PI / 4);
  ctx.fillStyle = c.bsFill; ctx.strokeStyle = c.ink2; ctx.lineWidth = 1.2;
  ctx.fillRect(-10, -10, 20, 20); ctx.strokeRect(-10, -10, 20, 20); ctx.beginPath(); ctx.moveTo(-10, 0); ctx.lineTo(10, 0); ctx.stroke();
  ctx.restore();
  // Arm cavities: input and end mirrors.
  ctx.save(); ctx.strokeStyle = c.ink; ctx.lineWidth = 3;
  for (const [x0, y0, x1, y1] of [[w * 0.47, by - 13, w * 0.47, by + 13], [xEnd, by - 13, xEnd, by + 13], [bx - 13, by - 24, bx + 13, by - 24], [bx - 13, yEnd, bx + 13, yEnd]]) {
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
  }
  ctx.restore();
  text(ctx, compact ? `4 km, ${(p.P / 1e3).toFixed(0)} kW` : `4 km arm cavity, ${(p.P / 1e3).toFixed(0)} kW`, (w * 0.47 + xEnd) / 2, by - 16, c, { base: 'bottom', color: c.ink });
  // The second arm is as long; it is drawn foreshortened, with a break mark.
  const ym = (yEnd + by - 24) / 2;
  ctx.save(); ctx.strokeStyle = c.panel; ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(bx - 8, ym + 4); ctx.lineTo(bx + 8, ym - 4); ctx.stroke();
  ctx.strokeStyle = c.ink2; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(bx - 8, ym + 7); ctx.lineTo(bx + 8, ym - 1); ctx.moveTo(bx - 8, ym + 1); ctx.lineTo(bx + 8, ym - 7); ctx.stroke(); ctx.restore();
  text(ctx, compact ? '4 km too' : '4 km too (foreshortened)', bx + 8, ym, c, { align: 'left', base: 'middle', color: c.ink });
  // Photodiode and the squeezer on the dark port.
  ctx.save(); ctx.translate(bx, yPd); ctx.rotate(Math.PI); ctx.fillStyle = c.ink2; ctx.beginPath(); ctx.arc(0, 0, 11, 0, Math.PI); ctx.closePath(); ctx.fill(); ctx.restore();
  text(ctx, 'photodiode', bx + 16, yPd - 2, c, { align: 'left', base: 'middle' });
  if (!compact) text(ctx, 'dark port: signal out', bx + 8, by + 22, c, { align: 'left', base: 'middle' });
  const iy = h * 0.72;
  // The Faraday isolator: a circle on the dark-port path that lets the squeezed light in and the signal out.
  ctx.save(); ctx.fillStyle = c.panel; ctx.strokeStyle = c.ink2; ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.arc(bx, iy, 10, 0, 2 * Math.PI); ctx.fill(); ctx.stroke(); ctx.restore();
  if (!compact) text(ctx, 'isolator', bx + 14, iy, c, { align: 'left', base: 'middle' });
  const s = Math.min(26, h * 0.12), ix = compact ? w * 0.24 : w * 0.19;
  if (p.sq.on) {
    // OPO → (filter cavity) → isolator → up the dark port.
    const ox = compact ? 24 : w * 0.07;
    box(ctx, ox - 18, iy - 10, 36, 20, c, c.crystal, c.ink2);
    text(ctx, compact ? 'squeezer' : 'squeezer (OPO)', ox, iy + 13, c);
    arrow(ctx, ox + 18, iy, ix - s - 2, iy, c.sq, 2, 7);
    cloudIcon(ctx, ix, iy, s, p.inject, c, { fill: c.sqFill, label: `${p.sq.dB.toFixed(1)} dB squeezed` });
    if (p.sq.fd) {
      const fx = (ix + s + bx - 10) / 2;
      arrow(ctx, ix + s + 2, iy, fx - 22, iy, c.sq, 2, 7);
      box(ctx, fx - 22, iy - 7, 44, 14, c, c.bsFill, c.ink2);
      text(ctx, 'filter cavity', fx, iy - 10, c, { base: 'bottom' });
      if (!compact) text(ctx, '300 m', fx, iy + 9, c);
      arrow(ctx, fx + 22, iy, bx - 12, iy, c.sq, 2, 7);
    } else arrow(ctx, ix + s + 2, iy, bx - 12, iy, c.sq, 2, 7);
    arrow(ctx, bx, iy - 10, bx, by + 16, c.sq, 2, 7, [5, 3]);
    if (!compact) text(ctx, 'squeezed vacuum in', bx - 14, (iy + by) / 2, c, { align: 'right', base: 'middle', color: c.sq });
  } else {
    cloudIcon(ctx, ix, iy, s, p.inject, c, { label: 'the vacuum' });
    arrow(ctx, ix + s + 2, iy, bx - 12, iy, c.ink3, 1.5, 7, [4, 3]);
    arrow(ctx, bx, iy - 10, bx, by + 16, c.ink3, 1.5, 7, [4, 3]);
    text(ctx, compact ? 'vacuum in' : 'the vacuum enters here', bx - 14, (iy + by) / 2, c, { align: 'right', base: 'middle', color: c.ink });
  }
}
