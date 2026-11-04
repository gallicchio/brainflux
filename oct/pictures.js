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
    label('line camera: one pixel per wavelength', camX1 + 1, camY, 'left', TEXT, 9);
  }
  const perPx = W / (2 * span * u);
  return {
    mirror: [mpx - 2 * u, mpy - 7 * u, 8 * u, 14 * u], u, span,
    toD: (px) => c + (px - (ox + EQ * u)) * perPx, perPx,
  };
}

function niceStep(W) {
  const raw = W / 5, p = 10 ** Math.floor(Math.log10(raw)), f = raw / p;
  return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * p;
}
function fmtUm(d) { return Math.abs(d) >= 1000 ? `${(d / 1000).toFixed(1)} mm` : `${+d.toFixed(2)}`; }

/**
 * The scene from the side: x across (μm), geometric depth z down, the bands coloured, the lesion,
 * the surface; the galvo mirror and lens above, and the beam at the column being measured,
 * drawn with its width w(z) and its focus.
 *   o: { scene, beam, x (the column), xRange: [x0, x1], zRange: [z0, z1] (geometric), air: the
 *       height of the air above the sample in the picture (a fraction), colors, pointer: {x, z} }
 * Returns { X(x), Z(z), left, top, w, h }: the map from scene to pixels.
 */
export function drawScene(canvas, o) {
  const { ctx, width, height } = fitCanvas(canvas);
  const sc = o.scene, [x0, x1] = o.xRange, [z0, z1] = o.zRange;
  const top = Math.round(height * 0.2), left = 0, w = width, h = height - top;
  const X = (x) => left + ((x - x0) / (x1 - x0)) * w, Z = (z) => top + ((z - z0) / (z1 - z0)) * h;
  ctx.fillStyle = '#0d0f14'; ctx.fillRect(0, 0, width, height);
  // The bands, column by column of pixels (the interfaces are curves).
  const nb = sc.bands.length, cols = Math.ceil(w), tops = new Float64Array(nb + 1);
  for (let px = 0; px < cols; px++) {
    const x = x0 + ((px + 0.5) / w) * (x1 - x0);
    for (let i = 0; i <= nb; i++) tops[i] = Z(sc.top(i, x, o.y || 0));
    for (let i = 0; i < nb; i++) {
      ctx.fillStyle = sc.bands[i].colour;
      ctx.globalAlpha = 0.25 + 0.75 * Math.min(1, sc.bands[i].scatter / 0.04);
      ctx.fillRect(left + px, tops[i], 1, Math.max(0, Math.min(height, tops[i + 1]) - tops[i]));
    }
    ctx.globalAlpha = 1;
    // Interfaces that reflect: a bright line.
    for (let i = 0; i < nb; i++) if (sc.bands[i].r) { ctx.fillStyle = `rgba(255,255,255,${Math.min(0.9, 0.3 + 12 * Math.abs(sc.bands[i].r))})`; ctx.fillRect(left + px, tops[i] - 0.5, 1, 1.5); }
  }
  // The lesion: the outline of its cross-section at this y.
  const L = sc.lesion;
  if (L && sc.opts.lesion) {
    const b = (o.y || 0) - L.y, s = 1 - (b * b) / (L.ry * L.ry);
    if (s > 0) {
      const rx = L.rx * Math.sqrt(s), rz = L.rz * Math.sqrt(s), zc = L.z - sc.base;
      ctx.save(); ctx.beginPath();
      for (let i = 0; i <= 60; i++) { const a = (i / 60) * 2 * Math.PI, x = L.x + rx * Math.cos(a); const z = sc.zTop(x, o.y || 0) + zc + rz * Math.sin(a); if (i) ctx.lineTo(X(x), Z(z)); else ctx.moveTo(X(x), Z(z)); }
      ctx.closePath();
      ctx.fillStyle = L.gain === 0 ? 'rgba(20,30,50,0.85)' : 'rgba(255,230,160,0.55)'; ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 1; ctx.stroke(); ctx.restore();
    }
  }
  // The galvo and the lens above; the beam.
  const gx = X(x0 + 0.08 * (x1 - x0)), gy = top * 0.22, lensY = top * 0.62;
  ctx.strokeStyle = BEAM; ctx.lineWidth = 2; ctx.globalAlpha = 0.9;
  ctx.beginPath(); ctx.moveTo(X(x0 - 0.0 * (x1 - x0)), gy + 1); ctx.lineTo(gx, gy); ctx.stroke();   // light in
  // The galvo mirror, tilted to send the beam to x.
  const ang = Math.atan2(h * 0.6, X(o.x) - gx) / 2 + Math.PI / 4;
  ctx.save(); ctx.translate(gx, gy); ctx.rotate(-ang); ctx.fillStyle = '#e6e9f0'; ctx.fillRect(-9, -1.5, 18, 3); ctx.restore();
  ctx.fillStyle = TEXT; ctx.font = '10px system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillText('galvo mirror: steps the beam', gx + 12, gy - 6);
  // The scan lens: a lens across the width.
  ctx.strokeStyle = 'rgba(180,200,255,0.8)'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(X(x0 + 0.03 * (x1 - x0)), lensY); ctx.quadraticCurveTo(X(0.5 * (x0 + x1)), lensY - 7, X(x1 - 0.03 * (x1 - x0)), lensY); ctx.quadraticCurveTo(X(0.5 * (x0 + x1)), lensY + 7, X(x0 + 0.03 * (x1 - x0)), lensY); ctx.stroke();
  ctx.fillStyle = DIM; ctx.fillText('lens', X(x1) - 30, lensY - 9);
  // The beam from the galvo to the lens, then focused into the sample: its 1/e² edges.
  const bx = X(o.x), bm = o.beam;
  ctx.strokeStyle = BEAM; ctx.lineWidth = 1.2; ctx.globalAlpha = 0.9;
  ctx.beginPath(); ctx.moveTo(gx, gy); ctx.lineTo(bx, lensY); ctx.stroke();
  if (bm) {
    const scale = w / (x1 - x0);
    ctx.fillStyle = `rgba(${BEAM_RGB},0.28)`; ctx.beginPath();
    const zs = [], NZ = 40;
    for (let i = 0; i <= NZ; i++) zs.push(z0 + ((z1 - z0) * i) / NZ);
    // Above the sample the beam converges from the lens's aperture (NA × distance).
    const dLens = (top - lensY) / (h / (z1 - z0));
    const wl = Math.max(bm.width(0), bm.NA * dLens);
    ctx.moveTo(bx - wl * scale * Math.max(1, 3 * o.exaggerate), lensY);
    for (const z of zs) ctx.lineTo(bx + bm.width(z) * scale * Math.max(1, 3 * o.exaggerate), Z(z));
    for (let i = NZ; i >= 0; i--) ctx.lineTo(bx - bm.width(zs[i]) * scale * Math.max(1, 3 * o.exaggerate), Z(zs[i]));
    ctx.lineTo(bx + wl * scale * Math.max(1, 3 * o.exaggerate), lensY);
    ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(bx, lensY); ctx.lineTo(bx, Z(z1)); ctx.strokeStyle = `rgba(${BEAM_RGB},0.9)`; ctx.lineWidth = 1; ctx.stroke();
    // The focus.
    const fy = Z(bm.zFocus);
    ctx.strokeStyle = GATE; ctx.lineWidth = 1; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(bx - 14, fy); ctx.lineTo(bx + 14, fy); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = GATE; ctx.textAlign = bx < width / 2 ? 'left' : 'right'; ctx.fillText('focus', bx + (bx < width / 2 ? 17 : -17), fy);
  }
  ctx.globalAlpha = 1;
  // Axes: x across the bottom, z down the left.
  ctx.fillStyle = DIM; ctx.font = '10px system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  ctx.fillText(`x: ${fmtUm(x0)} to ${fmtUm(x1)} μm across`, 4, top + 2);
  ctx.textBaseline = 'bottom'; ctx.fillText(`depth z down to ${fmtUm(z1)} μm (geometric; n = ${sc.n})`, 4, height - 3);
  // A scale bar: 200 μm.
  const sb = X(x0 + 200) - X(x0);
  ctx.fillStyle = TEXT; ctx.fillRect(width - sb - 8, height - 10, sb, 2); ctx.textAlign = 'right'; ctx.fillText('200 μm', width - 8, height - 12);
  if (o.pointer) {
    const { x, z } = o.pointer;
    ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(X(x), Z(z), 5, 0, 2 * Math.PI); ctx.stroke();
  }
  return { X, Z, left, top, w, h };
}

/**
 * Three slices of a volume drawn as planes inside a cube, in cabinet projection: x to the right,
 * z down, y receding up and to the right at half scale.  o: { nx, ny, nz, ix, iy, m (the slices),
 * xz, yz, xy (canvases of the slices), done (how many B-scans are measured), ny }.
 * Returns the projection { px(x, y, z) } with x, y, z in 0..1 fractions.
 */
export function drawCube(canvas, o) {
  const { ctx, width, height } = fitCanvas(canvas);
  ctx.fillStyle = '#0d0f14'; ctx.fillRect(0, 0, width, height);
  const ca = Math.cos(Math.PI / 6), sa = Math.sin(Math.PI / 6), r = 0.5;
  // The cube's extent in pixels: width = W + r W ca, height = H + r W sa.
  const margin = 14, aspect = 0.62;   // depth: width of the cube's front face
  let W = (width - 2 * margin) / (1 + r * ca), H = W * aspect;
  if (H + r * W * sa > height - 2 * margin) { H = (height - 2 * margin) / (aspect + r * sa) * aspect; W = H / aspect; }
  const x0 = margin + (width - 2 * margin - W - r * W * ca) / 2, y0 = margin + r * W * sa + (height - 2 * margin - H - r * W * sa) / 2;
  const px = (x, y, z) => [x0 + x * W + y * r * W * ca, y0 + z * H - y * r * W * sa];
  const quad = (pts, img, alpha = 1) => {
    // Draw img (a canvas) onto the parallelogram pts = [p00, p10, p01] (origin, +u, +v).
    const [a, b, c] = pts, iw = img.width, ih = img.height;
    ctx.save(); ctx.globalAlpha = alpha;
    ctx.setTransform((b[0] - a[0]) / iw, (b[1] - a[1]) / iw, (c[0] - a[0]) / ih, (c[1] - a[1]) / ih, a[0], a[1]);
    ctx.drawImage(img, 0, 0); ctx.restore();
    ctx.setTransform(window.devicePixelRatio || 1, 0, 0, window.devicePixelRatio || 1, 0, 0);
  };
  const edge = (p, q, style = 'rgba(255,255,255,0.35)', dash) => { ctx.strokeStyle = style; ctx.lineWidth = 1; ctx.setLineDash(dash || []); ctx.beginPath(); ctx.moveTo(...p); ctx.lineTo(...q); ctx.stroke(); ctx.setLineDash([]); };
  const fx = (o.ix + 0.5) / o.nx, fy = (o.iy + 0.5) / o.ny, fz = (o.m + 0.5) / o.nz;
  // The measured B-scans, as faint lines on the top face (the scan's progress).
  for (let iy = 0; iy < o.ny; iy++) if (o.done[iy]) { const t = (iy + 0.5) / o.ny; edge(px(0, t, 0), px(1, t, 0), 'rgba(255,90,60,0.25)'); }
  // The back edges of the cube.
  edge(px(0, 1, 0), px(1, 1, 0)); edge(px(0, 1, 0), px(0, 1, 1)); edge(px(0, 1, 1), px(1, 1, 1)); edge(px(1, 1, 0), px(1, 1, 1));
  edge(px(0, 0, 0), px(0, 1, 0)); edge(px(0, 0, 1), px(0, 1, 1)); edge(px(1, 0, 0), px(1, 1, 0));
  // The slices, far to near: the y–z plane at x = fx, the en-face plane at z = fz, the B-scan at y = fy.
  if (o.yz) quad([px(fx, 1, 0), px(fx, 0, 0), px(fx, 1, 1)], o.yz, 0.92);
  if (o.xy) quad([px(0, 1, fz), px(1, 1, fz), px(0, 0, fz)], o.xy, 0.92);
  if (o.xz) quad([px(0, fy, 0), px(1, fy, 0), px(0, fy, 1)], o.xz, 0.95);
  // The slices' outlines in their colours, and the front edges.
  const outline = (pts, style) => { ctx.strokeStyle = style; ctx.lineWidth = 1.5; ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(...p) : ctx.moveTo(...p))); ctx.closePath(); ctx.stroke(); };
  outline([px(fx, 0, 0), px(fx, 1, 0), px(fx, 1, 1), px(fx, 0, 1)], 'rgba(127,211,255,0.9)');
  outline([px(0, 0, fz), px(1, 0, fz), px(1, 1, fz), px(0, 1, fz)], 'rgba(255,224,138,0.9)');
  outline([px(0, fy, 0), px(1, fy, 0), px(1, fy, 1), px(0, fy, 1)], 'rgba(255,120,220,0.9)');
  edge(px(0, 0, 0), px(1, 0, 0)); edge(px(0, 0, 0), px(0, 0, 1)); edge(px(0, 0, 1), px(1, 0, 1)); edge(px(1, 0, 0), px(1, 0, 1));
  edge(px(1, 0, 1), px(1, 1, 1)); edge(px(0, 0, 1), px(0, 1, 1));
  // Labels.
  ctx.fillStyle = TEXT; ctx.font = '10px system-ui, sans-serif'; ctx.textBaseline = 'middle';
  ctx.textAlign = 'center'; ctx.fillText('x →', ...[(px(0, 0, 1)[0] + px(1, 0, 1)[0]) / 2, px(0, 0, 1)[1] + 9]);
  ctx.textAlign = 'left'; ctx.fillText('y ↗', px(1, 0.5, 1)[0] + 6, px(1, 0.5, 1)[1]);
  ctx.save(); ctx.translate(px(0, 0, 0.5)[0] - 8, px(0, 0, 0.5)[1]); ctx.rotate(-Math.PI / 2); ctx.textAlign = 'center'; ctx.fillText('depth ↓', 0, 0); ctx.restore();
  return { px, W, H, x0, y0, r, ca, sa };
}
