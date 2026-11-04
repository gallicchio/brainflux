// The pictures: the Michelson seen from above (time domain, with the reference mirror on its
// rail, and Fourier domain, with the spectrometer), the scene with the scanning beam, and the
// volume as a cube of three slices.  Drawing only: the physics is elsewhere.

import { fitCanvas } from '../lib/plot.js';

export const BEAM = '#ff5a3c';           // the light is infrared: drawn red by convention
const BEAM_RGB = '255,90,60';
const TEXT = 'rgba(225,226,230,0.85)', DIM = 'rgba(225,226,230,0.55)', GLASS = 'rgba(170,200,230,0.75)';
const GATE = '#ffe08a';

let boardCache = null;
function board(ctx, canvas, width, height, P) {
  const dpr = window.devicePixelRatio || 1;
  if (!boardCache || boardCache.width !== canvas.width || boardCache.height !== canvas.height) {
    boardCache = document.createElement('canvas'); boardCache.width = canvas.width; boardCache.height = canvas.height;
    const b = boardCache.getContext('2d');
    b.scale(dpr, dpr);
    b.fillStyle = '#1b1d22'; b.fillRect(0, 0, width, height);
    b.fillStyle = 'rgba(255,255,255,0.07)';
    for (let x = 2; x < 100; x += 4) for (let y = 2; y < 64; y += 4) { const [px, py] = P(x, y); b.fillRect(px - 0.8, py - 0.8, 1.6, 1.6); }
  }
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(boardCache, 0, 0); ctx.restore();
}

/**
 * The Michelson from above, 100 × 64 units: the source on the left, the beam splitter, the
 * reference mirror on its rail to the right, the sample below, the detector (or the
 * spectrometer) above.  The reference arm and the sample arm are drawn on one scale of path, so
 * that the mirror at position d is level with the depth d it matches; the gaps between the beam
 * splitter and the scales are not to scale.
 *   o: { fd (a spectrometer instead of a detector, the mirror fixed at o.dFixed), win: [lo, hi]
 *       (the mirror positions the rail shows, μm), d (the mirror's position), surfaces: [{ d, r,
 *       label }] (the sample's reflecting surfaces, at optical depth), slab: { d0, d1 } (a block
 *       drawn behind them), lc (the gate's width, μm), level (the detector's reading, 0..1),
 *       spectrum: Float32Array (fd: the camera's pixels, 0..1), label (the sample's name),
 *       glass (mm of uncompensated glass in the sample arm), sourceLabel }
 * Returns { mirror: [x, y, w, h] (its hit box, CSS px), u (px per unit), span, toD(px) }.
 */
export function drawMichelson(canvas, o) {
  const { ctx, width, height } = fitCanvas(canvas);
  const u = Math.min(width / 100, height / 64), ox = (width - 100 * u) / 2, oy = (height - 64 * u) / 2;
  const P = (x, y) => [ox + x * u, oy + y * u];
  board(ctx, canvas, width, height, P);
  const fs = (n) => Math.max(9, Math.min(13, (n * u) / 5));   // font sizes that grow a little with the picture
  const line = (pts, w, style, dash) => {
    ctx.strokeStyle = style; ctx.lineWidth = w; ctx.setLineDash(dash || []); ctx.beginPath();
    pts.forEach(([x, y], i) => { const [px, py] = P(x, y); if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py); });
    ctx.stroke(); ctx.setLineDash([]);
  };
  const label = (s, x, y, align = 'center', col = TEXT, size = 10) => {
    ctx.fillStyle = col; ctx.font = `${fs(size)}px system-ui, sans-serif`; ctx.textAlign = align; ctx.textBaseline = 'middle';
    const [px, py] = P(x, y); ctx.fillText(s, px, py);
  };
  const by = 22, BSx = 40, EQ = 74, SY = 46, span = 15, railY = by + 7, sx = BSx + 10;
  const [lo, hi] = o.win, W = hi - lo, c = 0.5 * (lo + hi);
  const off = (d) => (span * (d - c)) / (W / 2);              // μm → drawn units from the scale's middle
  const clampOff = (d) => Math.max(-span - 2, Math.min(span + 2, off(d)));
  const mx = EQ + clampOff(o.fd ? o.dFixed : o.d);
  // Beams: glow, then core.  The sample arm goes down to the deepest surface in view.
  const deepest = o.surfaces.length ? Math.max(...o.surfaces.map((q) => q.d)) : c;
  const yEnd = SY + Math.max(-span, Math.min(span + 2, off(deepest))) + 1.5;
  const beams = [[[14, by], [BSx, by]], [[BSx, by], [mx - 0.4, by]], [[BSx, by], [BSx, yEnd]], [[BSx, by], [BSx, o.fd ? 9 : 5.5]]];
  ctx.lineCap = 'round';
  for (const bm of beams) line(bm, 3 * u, `rgba(${BEAM_RGB},0.16)`);
  for (const bm of beams) line(bm, Math.max(1.2, 0.42 * u), BEAM);
  const arrow = (x, y, dx, dy) => { const [px, py] = P(x, y), s = 1.4 * u; ctx.fillStyle = BEAM; ctx.beginPath(); ctx.moveTo(px + dx * s, py + dy * s); ctx.lineTo(px - dx * s - dy * s * 0.7, py - dy * s + dx * s * 0.7); ctx.lineTo(px - dx * s + dy * s * 0.7, py - dy * s - dx * s * 0.7); ctx.closePath(); ctx.fill(); };
  arrow(27, by, 1, 0); arrow(BSx, 14, 0, -1); arrow(50, by, 1, 0); arrow(BSx, 27.5, 0, 1);
  // The source.
  ctx.fillStyle = '#3a3d46'; { const [x0, y0] = P(2, by - 3.4); ctx.fillRect(x0, y0, 11 * u, 6.8 * u); }
  label(o.sourceLabel || 'SLD', 7.5, by, 'center', TEXT, 10);
  label('broadband,', 7.5, by + 5.4, 'center', DIM, 9);
  label('infrared', 7.5, by + 8.2, 'center', DIM, 9);
  // Beam splitter.
  line([[BSx - 3.5, by + 3.5], [BSx + 3.5, by - 3.5]], 0.85 * u, GLASS);
  label('beam splitter', BSx - 5, by - 5, 'right', DIM, 9);
  // Uncompensated glass in the sample arm.
  if (o.glass > 0) {
    const [gx, gy] = P(BSx - 3, by + 3.6);
    ctx.fillStyle = 'rgba(150,200,240,0.35)'; ctx.fillRect(gx, gy, 6 * u, 2.6 * u);
    ctx.strokeStyle = 'rgba(150,200,240,0.8)'; ctx.lineWidth = 1; ctx.strokeRect(gx, gy, 6 * u, 2.6 * u);
    label(`BK7 glass, ${+o.glass.toFixed(2)} mm, no twin`, BSx - 4, by + 4.9, 'right', '#9fd0ff', 9);
  }
  // The reference mirror's rail and its scale.
  line([[EQ - span - 2, railY], [EQ + span + 2, railY]], 1, 'rgba(255,255,255,0.25)');
  const tick = niceStep(W);
  for (let d = Math.ceil(lo / tick) * tick; d <= hi + 1e-9 * tick; d += tick) {
    const x = EQ + off(d);
    line([[x, railY - 0.9], [x, railY + 0.9]], 1, 'rgba(255,255,255,0.4)');
    label(fmtUm(d), x, railY + 2.8, 'center', DIM, 8);
  }
  label('mirror position d (μm)', EQ, railY + 6, 'center', DIM, 9);
  label(o.fd ? 'reference mirror: fixed' : 'reference mirror: drag it', EQ + 2, 12.5, 'center', TEXT, 10);
  // The mirror on its carriage, with its grip.
  const [mpx, mpy] = P(mx, by), hl = 5.5 * u;
  ctx.fillStyle = '#2d3039'; ctx.fillRect(mpx + 1 * u, mpy - 6.5 * u, 4.5 * u, 13 * u);
  ctx.strokeStyle = '#e6e9f0'; ctx.lineWidth = 0.85 * u; ctx.beginPath(); ctx.moveTo(mpx, mpy - hl); ctx.lineTo(mpx, mpy + hl); ctx.stroke();
  if (!o.fd) { ctx.fillStyle = GATE; ctx.beginPath(); ctx.arc(mpx + 3.2 * u, mpy, Math.max(3.5, 1.1 * u), 0, 2 * Math.PI); ctx.fill(); }
  // The sample arm's scale of optical depth: the same numbers as the rail's.
  line([[sx, SY - span - 2], [sx, SY + span + 2]], 1, 'rgba(255,255,255,0.25)');
  for (let d = Math.ceil(lo / tick) * tick; d <= hi + 1e-9 * tick; d += tick) {
    const y = SY + off(d);
    line([[sx - 0.9, y], [sx + 0.9, y]], 1, 'rgba(255,255,255,0.4)');
    label(fmtUm(d), sx + 1.8, y, 'left', DIM, 8);
  }
  label('depth (optical)', sx - 1, SY - span - 4.2, 'left', DIM, 9);
  // The sample: a block between its surfaces (in optical path), and its surfaces.
  const yOf = (d) => SY + off(d), inView = (y) => y >= SY - span - 2 && y <= SY + span + 2;
  if (o.slab) {
    const y0 = Math.max(SY - span - 2, yOf(o.slab.d0)), y1 = Math.min(SY + span + 2, yOf(o.slab.d1));
    if (y1 > y0) {
      const [bx, byy] = P(BSx - 7, y0), [, by1] = P(BSx - 7, y1);
      ctx.fillStyle = 'rgba(120,170,220,0.18)'; ctx.fillRect(bx, byy, 14 * u, by1 - byy);
      if (o.label && y1 - y0 > 6) label(o.label, BSx - 8, (y0 + y1) / 2, 'right', TEXT, 10);
    }
  }
  for (const q of o.surfaces) {
    const y = yOf(q.d);
    if (!inView(y)) continue;
    const a = Math.min(1, 0.45 + 3 * Math.abs(q.r));
    line([[BSx - 7, y], [BSx + 7, y]], Math.max(1.2, 0.45 * u), `rgba(240,240,250,${a})`);
    if (q.label) label(q.label, BSx - 8, y, 'right', DIM, 9);
  }
  // The gate: the depth the mirror matches now, and the coherence length about it.
  if (!o.fd) {
    const gy = yOf(o.d), half = Math.max(0.25, (span * (o.lc / 2)) / (W / 2));
    if (inView(gy)) {
      const [gx0, gy0] = P(BSx - 9, gy - half), [gx1, gy1] = P(BSx + 9, gy + half);
      ctx.fillStyle = 'rgba(255,224,138,0.2)'; ctx.fillRect(gx0, gy0, gx1 - gx0, Math.max(1, gy1 - gy0));
      line([[BSx - 9, gy], [BSx + 9, gy]], 1.2, GATE, [4, 3]);
    }
    label('yellow: the depth the mirror matches, ±ℓ_c/2', 2, 62, 'left', GATE, 9);
  } else {
    label('the camera sees every depth at once', 2, 62, 'left', GATE, 9);
  }
  // The detector, or the spectrometer.
  if (!o.fd) {
    line([[BSx - 4.5, 5], [BSx + 4.5, 5]], 0.8 * u, '#9aa0ad');
    label('detector and its signal', BSx + 6, 4.6, 'left', TEXT, 10);
    const [qx, qy] = P(BSx + 6, 6.9), mw = 13 * u, mh = 1.6 * u;
    ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fillRect(qx, qy, mw, mh);
    ctx.fillStyle = BEAM; ctx.fillRect(qx, qy, mw * Math.max(0, Math.min(1, o.level ?? 0)), mh);
  } else {
    const gx = BSx, gy = 9;
    line([[gx - 4, gy + 2], [gx + 4, gy - 2]], 1.2, '#c9ccd4');
    label('grating', gx - 5, gy + 1.5, 'right', TEXT, 10);
    const camY = 3.2, camX0 = gx + 7, camX1 = gx + 38;
    for (let i = 0; i <= 10; i++) {
      const t = i / 10, x = camX0 + (camX1 - camX0) * t;
      line([[gx, gy], [x, camY + 1.3]], 0.8, `rgba(${BEAM_RGB},${0.1 + 0.3 * Math.exp(-8 * (t - 0.5) ** 2)})`);
    }
    const [cx0, cy0] = P(camX0, camY - 1.3), cw = (camX1 - camX0) * u, ch = 2.6 * u;
    ctx.fillStyle = '#2d3039'; ctx.fillRect(cx0, cy0, cw, ch);
    if (o.spectrum) {
      const n = o.spectrum.length;
      for (let i = 0; i < n; i++) {
        const v = Math.max(0, Math.min(1, o.spectrum[i]));
        ctx.fillStyle = `rgba(${BEAM_RGB},${0.08 + 0.92 * v})`;
        ctx.fillRect(cx0 + (cw * i) / n, cy0 + 0.3 * u, cw / n + 0.6, ch - 0.6 * u);
      }
    }
    label('line camera: a pixel per wavelength', camX0, camY + 3.4, 'left', TEXT, 9);
  }
  const perPx = W / (2 * span * u);
  return {
    mirror: [mpx - 2 * u, mpy - 7 * u, 8 * u, 14 * u], u, span,
    toD: (px) => c + (px - (ox + EQ * u)) * perPx, perPx,
  };
}

function niceStep(W) {
  const raw = W / 4, p = 10 ** Math.floor(Math.log10(raw)), f = raw / p;
  return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * p;
}
function fmtUm(d) { return `${+d.toFixed(2)}`; }

/**
 * The scene from the side: x across (μm), geometric depth z down, the bands coloured by how much
 * they scatter, the reflecting interfaces bright, the lesion and the beads; above it the galvo
 * mirror and the scan lens, and the beam at the column being measured, drawn to scale (its 1/e²
 * radius w(z) about its axis) with its focus.
 *   o: { scene, y (the row, for 3D scenes), beam, x (the beam's column), layout: { left, right,
 *       top (the tissue's top in px: the galvo and the lens are above), bottom }, pointer: { x, z } }
 * Returns { X(x), Z(z), invX(px), invZ(py), left, top, w, h }.
 */
export function drawScene(canvas, o) {
  const { ctx, width, height } = fitCanvas(canvas);
  const sc = o.scene, L = o.layout, y = o.y || 0, hw = sc.halfWidth;
  const left = L.left, w = width - L.left - L.right, top = L.top, h = height - L.top - L.bottom;
  const X = (x) => left + ((x + hw) / (2 * hw)) * w, Z = (z) => top + (z / sc.depth) * h;
  ctx.fillStyle = '#0d0f14'; ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#12151c'; ctx.fillRect(left, top, w, h);
  // The bands, pixel column by pixel column (their tops are curves).
  const nb = sc.nb, prof = { tops: new Float64Array(nb + 1), dtops: new Float64Array(nb + 1) };
  ctx.save(); ctx.beginPath(); ctx.rect(left, top, w, h); ctx.clip();
  for (let px = 0; px < Math.ceil(w); px++) {
    const x = -hw + ((px + 0.5) / w) * 2 * hw;
    sc.profile(x, y, prof);
    for (let i = 0; i < nb; i++) {
      const b = sc.bands[i], y0 = Z(prof.tops[i]), y1 = i + 1 < nb ? Z(prof.tops[i + 1]) : top + h;
      if (y1 <= y0) continue;
      ctx.fillStyle = b.colour; ctx.globalAlpha = 0.3 + 0.7 * Math.min(1, b.scatter / 0.04 + (b.cells ? 0.2 : 0));
      ctx.fillRect(left + px, y0, 1, y1 - y0);
      // Cell walls (an onion's): drawn where the column crosses one.
      if (b.cells) {
        const c = b.cells, u = x / c.sx + c.shift, v = y / c.sy + 0.5 + c.shiftY, du = Math.abs(u - Math.round(u)) * c.sx, dv = Math.abs(v - Math.round(v)) * c.sy;
        if (du < Math.max(c.wall / 2, (hw / w) * 0.75) || dv < c.wall / 2) { ctx.globalAlpha = 0.9; ctx.fillStyle = '#f0e6c0'; ctx.fillRect(left + px, y0, 1, y1 - y0); }
      }
    }
    ctx.globalAlpha = 1;
    for (let i = 0; i < nb; i++) if (sc.bands[i].r) {
      ctx.fillStyle = `rgba(255,255,255,${Math.min(0.95, 0.35 + 10 * Math.abs(sc.bands[i].r))})`;
      ctx.fillRect(left + px, Z(prof.tops[i]) - 0.75, 1, 1.5);
    }
  }
  // The lesion: its cross-section at this y.
  const Ls = sc.lesion;
  if (Ls && sc.opts.lesion) {
    const b = y - Ls.y, s = 1 - (b * b) / (Ls.ry * Ls.ry);
    if (s > 0) {
      const rx = Ls.rx * Math.sqrt(s), rz = Ls.rz * Math.sqrt(s);
      ctx.beginPath();
      for (let i = 0; i <= 72; i++) { const a = (i / 72) * 2 * Math.PI, x = Ls.x + rx * Math.cos(a), z = sc.zSurf(x, y) + Ls.dz + rz * Math.sin(a); if (i) ctx.lineTo(X(x), Z(z)); else ctx.moveTo(X(x), Z(z)); }
      ctx.closePath();
      ctx.fillStyle = Ls.gain === 0 ? 'rgba(12,18,30,0.92)' : 'rgba(255,230,160,0.55)'; ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 1; ctx.stroke();
    }
  }
  // Beads.
  if (sc.beads) {
    ctx.fillStyle = '#ffffff';
    for (const bd of sc.beadsNear(0, y, hw)) if (Math.abs(bd.y - y) < 1) { ctx.beginPath(); ctx.arc(X(bd.x), Z(bd.z), 1.6, 0, 2 * Math.PI); ctx.fill(); }
  }
  ctx.restore();
  // The galvo mirror and the scan lens above the sample; the beam.
  const bx = X(o.x), bm = o.beam, gy = Math.max(16, top * 0.36), lensY = top * 0.72, gx = left + 0.06 * w;
  ctx.strokeStyle = BEAM; ctx.lineWidth = 1.6; ctx.globalAlpha = 0.9;
  ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(gx, gy); ctx.lineTo(bx, lensY); ctx.stroke();
  ctx.save(); ctx.translate(gx, gy); ctx.rotate(Math.atan2(lensY - gy, bx - gx) / 2); ctx.fillStyle = '#e6e9f0'; ctx.fillRect(-8, -1.5, 16, 3); ctx.restore();
  ctx.globalAlpha = 1;
  ctx.fillStyle = TEXT; ctx.font = '11px system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillText(w > 560 ? 'galvo mirror: turns to step the beam across' : 'galvo mirror', gx + 12, gy - 9);
  ctx.strokeStyle = 'rgba(180,200,255,0.85)'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(left + 4, lensY); ctx.quadraticCurveTo(left + w / 2, lensY - 6, left + w - 4, lensY); ctx.quadraticCurveTo(left + w / 2, lensY + 6, left + 4, lensY); ctx.stroke();
  ctx.fillStyle = DIM; ctx.textAlign = 'right'; ctx.fillText('scan lens', left + w - 6, lensY - 10);
  if (bm) {
    // The beam's 1/e² edges, to scale (and at least a pixel and a half wide, to be seen).
    const kx = w / (2 * hw), NZ = 60;
    const half = (z) => Math.max(0.75, bm.width(z) * kx);
    ctx.fillStyle = `rgba(${BEAM_RGB},0.35)`; ctx.beginPath();
    ctx.moveTo(bx - Math.max(2, bm.NA * (top - lensY) * 0.6), lensY);
    for (let i = 0; i <= NZ; i++) { const z = (sc.depth * i) / NZ; ctx.lineTo(bx + half(z), Z(z)); }
    for (let i = NZ; i >= 0; i--) { const z = (sc.depth * i) / NZ; ctx.lineTo(bx - half(z), Z(z)); }
    ctx.lineTo(bx + Math.max(2, bm.NA * (top - lensY) * 0.6), lensY);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = `rgba(${BEAM_RGB},0.95)`; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(bx, lensY); ctx.lineTo(bx, top + h); ctx.stroke();
    const fy = Z(bm.zFocus);
    ctx.strokeStyle = GATE; ctx.lineWidth = 1; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(bx - 12, fy); ctx.lineTo(bx + 12, fy); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = GATE; ctx.textAlign = bx < left + w / 2 ? 'left' : 'right'; ctx.fillText('focus', bx + (bx < left + w / 2 ? 15 : -15), fy);
  }
  // A scale bar.
  const bar = hw >= 1000 ? 500 : 100, sb = (bar / (2 * hw)) * w;
  ctx.fillStyle = TEXT; ctx.fillRect(left + w - sb - 8, top + h - 9, sb, 2);
  ctx.textAlign = 'right'; ctx.textBaseline = 'bottom'; ctx.font = '11px system-ui, sans-serif'; ctx.fillText(`${bar} μm`, left + w - 8, top + h - 11);
  if (o.pointer) {
    ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(X(o.pointer.x), Z(o.pointer.z), 5, 0, 2 * Math.PI); ctx.stroke();
  }
  return { X, Z, invX: (px) => -hw + ((px - left) / w) * 2 * hw, invZ: (py) => ((py - top) / h) * sc.depth, left, top, w, h };
}

/**
 * Three slices of a volume drawn as planes inside a cube, in cabinet projection: x to the right,
 * depth down, y receding up and to the right at half scale.
 *   o: { nx, ny, nz, ix, iy, m (where the slices are), xz, yz, xy (canvases holding the slices'
 *       images: x across and depth down; y across and depth down; x across and y down), done (which
 *       B-scans are measured), surface (optional: Float32Array nx × ny, the en-face slab's depth
 *       under each A-scan as a fraction of the cube's, when it follows a layer rather than lying
 *       flat at m: drawn curved, in small tiles each tilted to its corners' depths) }
 */
let slabCanvas = null;
export function drawCube(canvas, o) {
  const { ctx, width, height } = fitCanvas(canvas);
  const dpr = window.devicePixelRatio || 1;
  ctx.fillStyle = '#0d0f14'; ctx.fillRect(0, 0, width, height);
  const ca = Math.cos(Math.PI / 6), sa = Math.sin(Math.PI / 6), r = 0.55, aspect = 0.5;
  const margin = 26;
  let W = (width - 2 * margin) / (1 + r * ca), H = W * aspect;
  if (H + r * W * sa > height - 2 * margin) { W = (height - 2 * margin) / (aspect + r * sa); H = W * aspect; }
  const x0 = (width - W - r * W * ca) / 2, y0 = (height - H - r * W * sa) / 2 + r * W * sa;
  const px = (x, y, z) => [x0 + x * W + y * r * W * ca, y0 + z * H - y * r * W * sa];
  const quad = (a, b, c, img, alpha) => {
    if (!img || !img.width) return;
    const iw = img.width, ih = img.height;
    ctx.save(); ctx.globalAlpha = alpha;
    ctx.setTransform(dpr * (b[0] - a[0]) / iw, dpr * (b[1] - a[1]) / iw, dpr * (c[0] - a[0]) / ih, dpr * (c[1] - a[1]) / ih, dpr * a[0], dpr * a[1]);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(img, 0, 0); ctx.restore();
  };
  const edge = (p, q, style = 'rgba(255,255,255,0.35)') => { ctx.strokeStyle = style; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(...p); ctx.lineTo(...q); ctx.stroke(); };
  const outline = (pts, style) => { ctx.strokeStyle = style; ctx.lineWidth = 1.5; ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(...p) : ctx.moveTo(...p))); ctx.closePath(); ctx.stroke(); };
  const fx = (o.ix + 0.5) / o.nx, fy = (o.iy + 0.5) / o.ny, fz = (o.m + 0.5) / o.nz;
  // The back edges of the cube.
  edge(px(0, 1, 0), px(1, 1, 0)); edge(px(0, 1, 0), px(0, 1, 1)); edge(px(0, 1, 1), px(1, 1, 1)); edge(px(1, 1, 0), px(1, 1, 1));
  edge(px(0, 0, 0), px(0, 1, 0)); edge(px(0, 0, 1), px(0, 1, 1));
  // The measured B-scans, as faint lines on the top face: the scan's progress along y.
  for (let iy = 0; iy < o.ny; iy++) if (o.done[iy]) { const t = (iy + 0.5) / o.ny; edge(px(0, t, 0), px(1, t, 0), 'rgba(255,90,60,0.3)'); }
  // The slices: the cross-section at x, the en-face plane at depth, the B-scan at y.
  quad(px(fx, 0, 0), px(fx, 1, 0), px(fx, 0, 1), o.yz, 0.9);
  if (o.surface && o.xy && o.xy.width) {
    // The slab following a layer: tiles of T × T pixels of its image, each mapped to the depths
    // of its corners (the mean of the A-scans around each corner), drawn back to front onto a
    // canvas of their own (opaque, overlapping by a little so no seams show), then laid in the
    // cube like the other slices.
    const nx = o.nx, ny = o.ny, S = o.surface, T = 2;
    const zc = (i, j) => { let s = 0, n = 0; for (const a of [i - 1, i]) for (const b of [j - 1, j]) if (a >= 0 && a < nx && b >= 0 && b < ny) { s += S[b * nx + a]; n++; } return s / n; };
    if (!slabCanvas || slabCanvas.width !== canvas.width || slabCanvas.height !== canvas.height) { slabCanvas = document.createElement('canvas'); slabCanvas.width = canvas.width; slabCanvas.height = canvas.height; }
    const g = slabCanvas.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, slabCanvas.width, slabCanvas.height); g.imageSmoothingEnabled = true;
    const e = 0.35;   // the overlap, in image pixels
    for (let ty = ny - T; ty >= 0; ty -= T) for (let tx = 0; tx < nx; tx += T) {
      const a = px(tx / nx, ty / ny, zc(tx, ty)), b = px((tx + T) / nx, ty / ny, zc(tx + T, ty)), c = px(tx / nx, (ty + T) / ny, zc(tx, ty + T));
      g.setTransform(dpr * (b[0] - a[0]) / T, dpr * (b[1] - a[1]) / T, dpr * (c[0] - a[0]) / T, dpr * (c[1] - a[1]) / T, dpr * a[0], dpr * a[1]);
      g.drawImage(o.xy, tx, ty, T, T, -e, -e, T + 2 * e, T + 2 * e);
    }
    ctx.save(); ctx.globalAlpha = 0.9; ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(slabCanvas, 0, 0); ctx.restore();
    const curve = (pts) => { ctx.strokeStyle = SLICE.xy; ctx.lineWidth = 1.5; ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(...p) : ctx.moveTo(...p))); ctx.stroke(); };
    curve(Array.from({ length: nx + 1 }, (_, i) => px(i / nx, 0, zc(i, 0)))); curve(Array.from({ length: nx + 1 }, (_, i) => px(i / nx, 1, zc(i, ny))));
    curve(Array.from({ length: ny + 1 }, (_, j) => px(0, j / ny, zc(0, j)))); curve(Array.from({ length: ny + 1 }, (_, j) => px(1, j / ny, zc(nx, j))));
  } else quad(px(0, 0, fz), px(1, 0, fz), px(0, 1, fz), o.xy, 0.9);
  quad(px(0, fy, 0), px(1, fy, 0), px(0, fy, 1), o.xz, 0.92);
  outline([px(fx, 0, 0), px(fx, 1, 0), px(fx, 1, 1), px(fx, 0, 1)], SLICE.yz);
  if (!o.surface) outline([px(0, 0, fz), px(1, 0, fz), px(1, 1, fz), px(0, 1, fz)], SLICE.xy);
  outline([px(0, fy, 0), px(1, fy, 0), px(1, fy, 1), px(0, fy, 1)], SLICE.xz);
  // The front edges.
  edge(px(0, 0, 0), px(1, 0, 0)); edge(px(0, 0, 0), px(0, 0, 1)); edge(px(0, 0, 1), px(1, 0, 1)); edge(px(1, 0, 0), px(1, 0, 1));
  edge(px(1, 0, 1), px(1, 1, 1)); edge(px(1, 0, 0), px(1, 1, 0));
  ctx.fillStyle = TEXT; ctx.font = '11px system-ui, sans-serif'; ctx.textBaseline = 'middle';
  const bx = px(0.5, 0, 1); ctx.textAlign = 'center'; ctx.fillText('x →', bx[0], bx[1] + 11);
  const by = px(1, 0.5, 1); ctx.textAlign = 'left'; ctx.fillText('y ↗', by[0] + 7, by[1] + 4);
  const bz = px(0, 0, 0.5); ctx.save(); ctx.translate(bz[0] - 10, bz[1]); ctx.rotate(-Math.PI / 2); ctx.textAlign = 'center'; ctx.fillText('depth ↓', 0, 0); ctx.restore();
  return { px };
}

/** The colours of the three slices, the same in the cube and in each slice's own picture. */
export const SLICE = { xz: '#ff78dc', yz: '#7fd3ff', xy: '#ffe08a' };
