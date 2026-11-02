// The two small pictures of the medium view, drawn on canvases: one charge on its spring, shaken
// by the field of the light, and the light's wave meeting the medium.  Everything they show comes
// in as arguments (the physics is in medium.js); the page decides when to draw them.

import { fillSlots } from '../lib/plot.js';
import { surfaceWave } from './medium.js';

const FONT = '12px system-ui, sans-serif', SMALL = '11px system-ui, sans-serif';
const DEG = 180 / Math.PI;

/** What the lag of the charge behind the field means, in a few words. */
export function lagVerdict(lag) {
  const d = lag * DEG;
  if (d < -3) return 'ahead of E: Im χ < 0, it gives energy to the wave (gain)';
  if (d < 25) return 'in step with E: its χ′ > 0, it raises n; it hardly absorbs';
  if (d < 65) return 'behind E: it raises n, and absorbs some';
  if (d <= 115) return 'a quarter period behind: E does work on it, so it absorbs';
  if (d <= 155) return 'more than ¼ period behind: it lowers n, and absorbs some';
  return 'against E: its χ′ < 0, it lowers n; it hardly absorbs';
}

/** A zigzag spring from x0 to x1 at height y. */
function spring(ctx, x0, x1, y, turns = 7, h = 7) {
  const lead = 6, n = turns * 2;
  ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x0 + lead, y);
  for (let i = 1; i < n; i++) ctx.lineTo(x0 + lead + ((x1 - x0 - 2 * lead) * i) / n, y + (i % 2 ? -h : h));
  ctx.lineTo(x1 - lead, y); ctx.lineTo(x1, y); ctx.stroke();
}

function arrow(ctx, x0, y0, x1, y1, head = 7) {
  const a = Math.atan2(y1 - y0, x1 - x0), L = Math.hypot(x1 - x0, y1 - y0);
  ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
  if (L < 2) return;
  const h = Math.min(head, 0.8 * L);
  ctx.beginPath(); ctx.moveTo(x1, y1);
  ctx.lineTo(x1 - h * Math.cos(a - 0.45), y1 - h * Math.sin(a - 0.45));
  ctx.lineTo(x1 - h * Math.cos(a + 0.45), y1 - h * Math.sin(a + 0.45));
  ctx.closePath(); ctx.fill();
}

/**
 * The driven charge.  o: { phase (ωt now, radians), amp (A, its amplitude over the static pull),
 * lag (δ), free (no spring), polarisation (no charge: a typed or drawn medium, whose P lags E by
 * arg χ and has the size |χ|), title, colors (with .charge and .field) }.
 * Left: a charge on a spring and the field E pushing it; right: E(t) and x(t) over the last two
 * periods (the present at the right edge), each drawn to the same height so that the lag shows;
 * below, the lag and the amplitude in numbers, and what they mean.
 */
export function drawCharge(ctx, W, H, o) {
  const c = o.colors, narrow = W < 430;
  ctx.clearRect(0, 0, W, H);
  ctx.save();
  ctx.font = FONT; ctx.fillStyle = c.ink2; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  ctx.fillText(o.title, 10, 7);
  // ---- the charge on its spring
  const yc = Math.round(26 + (H - 26 - 40) / 2), xw = 14, xe = narrow ? 0.27 * W : 0.24 * W, D = narrow ? 0.14 * W : 0.1 * W;
  const xName = o.polarisation ? 'P' : 'x';
  if (!o.polarisation) {
  // Shown amplitude: the true one squeezed (A/(A + 2.33): 0.3 for the static pull, 0.81 for ten times it).
  const A = Number.isFinite(o.amp) ? o.amp : 1e9, shown = D * (A / (A + 2.33));
  const xq = xe + shown * Math.cos(o.phase - o.lag), E = Math.cos(o.phase);
  ctx.strokeStyle = c.ink3; ctx.lineWidth = 1;
  // The wall the spring hangs from, hatched.
  ctx.beginPath(); ctx.moveTo(xw, yc - 22); ctx.lineTo(xw, yc + 22); ctx.stroke();
  for (let y = yc - 20; y <= yc + 20; y += 6) { ctx.beginPath(); ctx.moveTo(xw, y); ctx.lineTo(xw - 5, y + 5); ctx.stroke(); }
  // Where the charge sits with no field.
  ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.moveTo(xe, yc - 18); ctx.lineTo(xe, yc + 26); ctx.stroke(); ctx.setLineDash([]);
  if (o.free) {
    ctx.fillStyle = c.ink3; ctx.font = SMALL; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillText('free: no spring', xw + 4, yc + 28);
  } else {
    ctx.strokeStyle = c.ink2; ctx.lineWidth = 1.3;
    spring(ctx, xw, xq - 9, yc);
  }
  ctx.fillStyle = c.charge; ctx.strokeStyle = c.panel; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.arc(xq, yc, 9, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
  ctx.fillStyle = c.panel; ctx.font = '600 11px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('q', xq, yc + 0.5);
  // The field pushing it, an arrow above, and its label.
  ctx.strokeStyle = c.field; ctx.fillStyle = c.field; ctx.lineWidth = 2.2;
  arrow(ctx, xe, yc - 28, xe + D * E, yc - 28);
  ctx.font = SMALL; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillText('E', xe + D + 8, yc - 28);
  }
  // ---- E(t) and x(t)
  const tx0 = o.polarisation ? 14 : narrow ? 0.5 * W : 0.44 * W, tx1 = W - 12, th = Math.min(0.26 * H, 34), periods = 2;
  ctx.strokeStyle = c.line; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(tx0, yc); ctx.lineTo(tx1, yc); ctx.stroke();
  const at = (u) => o.phase - 2 * Math.PI * periods * (1 - u); // the phase at fraction u of the window
  // (E broader and underneath, so that both show when x moves in step with it.)
  for (const [col, lag, wdt] of [[c.field, 0, 3.2], [c.charge, o.lag, 1.8]]) {
    ctx.strokeStyle = col; ctx.lineWidth = wdt; ctx.beginPath();
    for (let i = 0; i <= 160; i++) { const u = i / 160, x = tx0 + (tx1 - tx0) * u, y = yc - th * Math.cos(at(u) - lag); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
    ctx.stroke();
  }
  // The lag: from a crest of E to the crest of x that follows it.
  const span = 2 * Math.PI * periods, m = Math.floor((o.phase - 0.75 * span) / (2 * Math.PI)) + 1;
  const pE = 2 * Math.PI * m, uE = 1 - (o.phase - pE) / span, uX = uE + o.lag / span;
  if (o.lag > 0.06 && uX <= 1) {
    const xa = tx0 + (tx1 - tx0) * uE, xb = tx0 + (tx1 - tx0) * uX, y = yc - th - 7;
    ctx.strokeStyle = c.ink2; ctx.fillStyle = c.ink2; ctx.lineWidth = 1;
    ctx.setLineDash([2, 2]);
    ctx.beginPath(); ctx.moveTo(xa, yc - th); ctx.lineTo(xa, y - 3); ctx.moveTo(xb, yc - th); ctx.lineTo(xb, y - 3); ctx.stroke();
    ctx.setLineDash([]);
    arrow(ctx, xa, y, xb, y, 5);
    ctx.font = SMALL; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.fillText('δ', (xa + xb) / 2, y - 2);
  }
  ctx.font = SMALL; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
  ctx.fillStyle = c.field; ctx.fillText('E', tx1 - 30, yc + th + 9);
  ctx.fillStyle = c.charge; ctx.fillText(xName, tx1 - 16, yc + th + 9);
  ctx.fillStyle = c.ink3; ctx.textAlign = 'left'; ctx.fillText('time →', tx0, yc + th + 9);
  // ---- in numbers, and in words
  ctx.font = FONT; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'; ctx.fillStyle = c.ink;
  const ampParts = o.polarisation ? [' · |χ| = ', { v: o.amp, dec: 3, w: 6, tiny: true }]
    : o.free ? [' · amplitude ', { v: o.amp, dec: 2, w: 6, tiny: true }, ' × qE/mω_p²'] : [' · amplitude ', { v: o.amp, dec: 2, w: 6, tiny: true }, ' × the static pull'];
  fillSlots(ctx, [`${xName} lags E by δ = `, { v: o.lag * DEG, dec: 0, w: 4 }, '°', ...ampParts], 10, H - 24);
  ctx.fillStyle = c.ink2;
  ctx.fillText(lagVerdict(o.lag), 10, H - 8);
  ctx.restore();
}

/**
 * The light's wave meeting the medium at z = 0 (vacuum to the left), at the moment φ = ωt.
 * o: { n, k, phase, R, colors }.  z runs from −2 to 4 vacuum wavelengths.  The field (with its
 * envelope, faint), scale bars of λ0 outside and λ0/n inside, and the 1/e point of the decay.
 */
export function drawWave(ctx, W, H, o) {
  const c = o.colors, z0 = -2, z1 = 4, left = 10, right = W - 10, top = 26, bottom = H - 50;
  const X = (z) => left + ((z - z0) / (z1 - z0)) * (right - left), Y = (e) => (top + bottom) / 2 - (e / 2.1) * ((bottom - top) / 2);
  ctx.clearRect(0, 0, W, H);
  ctx.save();
  ctx.font = FONT; ctx.fillStyle = c.ink2; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  ctx.fillText(o.title, 10, 7);
  // The medium, tinted.
  ctx.fillStyle = c.spec; ctx.fillRect(X(0), top, right - X(0), bottom - top);
  ctx.strokeStyle = c.ink3; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(X(0) + 0.5, top); ctx.lineTo(X(0) + 0.5, bottom); ctx.stroke();
  // The field, and its envelope.
  const cols = Math.max(60, Math.round(right - left)), zs = Float64Array.from({ length: cols + 1 }, (_, i) => z0 + ((z1 - z0) * i) / cols);
  const { E, env } = surfaceWave(o.n, o.k, zs, o.phase);
  ctx.strokeStyle = c.ink3; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
  for (const s of [1, -1]) { ctx.beginPath(); for (let i = 0; i <= cols; i++) { const x = X(zs[i]), y = Y(s * env[i]); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); } ctx.stroke(); }
  ctx.setLineDash([]);
  ctx.strokeStyle = c.field; ctx.lineWidth = 2;
  ctx.beginPath(); for (let i = 0; i <= cols; i++) { const x = X(zs[i]), y = Y(E[i]); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); } ctx.stroke();
  // Where the amplitude has fallen by e.
  const ze = o.k > 0 ? 1 / (2 * Math.PI * o.k) : Infinity;
  if (ze < z1 - 0.05) {
    const { env: e1 } = surfaceWave(o.n, o.k, Float64Array.of(ze), 0), x = X(ze), y = Y(e1[0]);
    ctx.fillStyle = c.im; ctx.beginPath(); ctx.arc(x, y, 3.5, 0, 2 * Math.PI); ctx.fill();
    ctx.font = SMALL; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
    ctx.fillText('1/e', x + 4, y - 2);
  }
  // Which side is which, with a halo so that a crest can pass behind the words.
  ctx.font = SMALL; ctx.textBaseline = 'top'; ctx.lineWidth = 3; ctx.lineJoin = 'round'; ctx.strokeStyle = c.panel; ctx.fillStyle = c.ink2;
  for (const [txt, x, al] of [['vacuum', X(0) - 5, 'right'], ['medium', X(0) + 5, 'left']]) { ctx.textAlign = al; ctx.strokeText(txt, x, top + 3); ctx.fillText(txt, x, top + 3); }
  // Scale bars, under the wave: one wavelength outside, λ0/n inside.
  const bar = (za, zb, label, y) => {
    const xa = X(za), xb = Math.min(right - 2, X(zb));
    ctx.strokeStyle = c.ink2; ctx.fillStyle = c.ink2; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(xa, y - 4); ctx.lineTo(xa, y + 4); ctx.moveTo(xa, y); ctx.lineTo(xb, y);
    if (X(zb) <= right - 2) { ctx.moveTo(xb, y - 4); ctx.lineTo(xb, y + 4); }
    ctx.stroke();
    ctx.font = SMALL; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(label, xb + 5, y);
  };
  const yb = bottom + 12;
  bar(-1.9, -0.9, 'λ₀', yb);
  if (o.n > 0.28) bar(0.1, 0.1 + 1 / o.n, 'λ₀/n', yb);
  else { ctx.font = SMALL; ctx.fillStyle = c.ink2; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText('n ≈ 0: no crests travel in', X(0.1), yb); }
  // In numbers.
  ctx.font = FONT; ctx.fillStyle = c.ink; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  const narrow = W < 480, fades = Number.isFinite(ze) && ze < 1e4;
  const fade = fades ? [narrow ? '1/e in ' : 'the amplitude falls by 1/e in ', { v: ze, dec: 2, w: 6, tiny: true }, ' λ₀'] : ['no absorption'];
  fillSlots(ctx, ['R = ', { v: 100 * o.R, dec: 1, w: 5 }, narrow ? '% reflected · inside, ' : '% reflected · inside, ', ...fade], 10, H - 9);
  ctx.restore();
}
