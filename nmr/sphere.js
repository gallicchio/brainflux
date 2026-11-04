// The Bloch sphere drawn on a canvas: an orthographic view that the reader turns by dragging,
// the axes (x, y, z in the lab frame; x′, y′, z in the rotating frame), the fields as arrows,
// one or many magnetization arrows, the tip's trail, its projections, and the cone a spin
// sweeps when it precesses too fast to draw.  It knows nothing of the physics: the page hands it
// vectors (unit sphere = the equilibrium magnetization) and labels.

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export class SphereView {
  constructor() {
    this.az = 0.55;     // the view: turned this far about z (x towards the reader, a little left)
    this.el = 0.32;     // and tilted this far up
    this.cx = 0; this.cy = 0; this.R = 100;
    this.basis();
  }

  /** The screen's right, up and towards-the-reader directions in the sphere's axes. */
  basis() {
    const ca = Math.cos(this.az), sa = Math.sin(this.az), ce = Math.cos(this.el), se = Math.sin(this.el);
    this.r = [-sa, ca, 0];
    this.u = [-se * ca, -se * sa, ce];
    this.d = [ce * ca, ce * sa, se];
  }

  /** Look from another direction. */
  look(az, el) { this.az = az; this.el = el; this.basis(); }

  /** Turn the view by a drag of (dx, dy) pixels. */
  turn(dx, dy) {
    this.az -= dx * 0.008;
    this.el = clamp(this.el + dy * 0.008, -1.2, 1.45);
    this.basis();
  }

  /** Fit the sphere into a box of w × h pixels (room left for the field arrows and labels). */
  fit(w, h) {
    this.R = Math.max(40, Math.min(w * 0.34, h * 0.31));
    this.cx = w / 2; this.cy = h / 2 + 0.02 * this.R;
  }

  /** The screen point of a vector: [X, Y, depth] (depth > 0 towards the reader). */
  P(v) {
    const { r, u, d } = this;
    return [this.cx + this.R * (v[0] * r[0] + v[1] * r[1] + v[2] * r[2]),
      this.cy - this.R * (v[0] * u[0] + v[1] * u[1] + v[2] * u[2]),
      v[0] * d[0] + v[1] * d[1] + v[2] * d[2]];
  }

  /** The point on the sphere's near side under the screen point (X, Y): a unit vector (on the
   *  rim when the point is outside the disc).  back: the far side instead. */
  pick(X, Y, back = false) {
    let a = (X - this.cx) / this.R, b = -(Y - this.cy) / this.R;
    const q = a * a + b * b;
    let c = 0;
    if (q > 1) { const s = 1 / Math.sqrt(q); a *= s; b *= s; } else c = Math.sqrt(1 - q) * (back ? -1 : 1);
    const { r, u, d } = this;
    return [a * r[0] + b * u[0] + c * d[0], a * r[1] + b * u[1] + c * d[1], a * r[2] + b * u[2] + c * d[2]];
  }

  /**
   * Draw the sphere and everything on it.  scene: {
   *   colors: {ink, ink2, ink3, line, panel, m, sum, b0, b1, beff, mz, mxy, trail, cone},
   *   frame: 'lab' | 'rot', axisLabels: [x, y, z],
   *   fields: [{v, color, label, dash, from}] (arrows from the origin, or from `from`; v of any length),
   *   spins: [{v, color, width}] (thin arrows, the fan), sum: v or null (the main arrow),
   *   trail: [v...], projections: bool, cone: {axis, v} or null (the sum precessing too fast to draw),
   *   tipHover: bool }
   */
  draw(ctx, scene) {
    const c = scene.colors, R = this.R;
    ctx.save();
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';

    // The coil round the sample, along its axis: its far halves behind the sphere.
    const coilAxis = scene.coilAxis || [1, 0, 0];
    if (scene.coil) this.coil(ctx, c, 'back', coilAxis);
    // The sphere: a disc with a soft shading, the far half of the equator and of one meridian dashed.
    const g = ctx.createRadialGradient(this.cx - 0.35 * R, this.cy - 0.4 * R, 0.1 * R, this.cx, this.cy, R);
    g.addColorStop(0, c.sphereHi); g.addColorStop(1, c.sphereLo);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(this.cx, this.cy, R, 0, 2 * Math.PI); ctx.fill();
    ctx.strokeStyle = c.line; ctx.lineWidth = 1.2; ctx.stroke();
    this.circle(ctx, (t) => [Math.cos(t), Math.sin(t), 0], c.ink3, 'back');
    this.circle(ctx, (t) => [Math.cos(t), 0, Math.sin(t)], c.line, 'back');
    this.circle(ctx, (t) => [0, Math.cos(t), Math.sin(t)], c.line, 'back');

    // The axes, behind the arrows where they are behind the sphere's centre.
    const L = 1.22, labels = scene.axisLabels || ['x', 'y', 'z'];
    const axes = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    ctx.font = '13px system-ui, sans-serif';
    axes.forEach((a, i) => this.axis(ctx, a, L, labels[i], c, i === 2));

    // What lies behind the sphere's middle plane (towards the reader is +depth) first.
    const items = [];
    for (const f of scene.fields || []) items.push({ depth: this.P(f.v.map((x) => x * 0.6))[2], draw: () => this.fieldArrow(ctx, f, c) });
    for (const s of scene.spins || []) items.push({ depth: this.P(s.v)[2] - 0.01, draw: () => this.arrow(ctx, s.v, s.color, s.width ?? 1.2, 6, s.alpha ?? 0.85) });
    items.sort((a, b) => a.depth - b.depth);
    for (const it of items) if (it.depth < 0) it.draw();

    // The near halves of the circles.
    this.circle(ctx, (t) => [Math.cos(t), Math.sin(t), 0], c.ink3, 'front');
    this.circle(ctx, (t) => [Math.cos(t), 0, Math.sin(t)], c.line, 'front');
    this.circle(ctx, (t) => [0, Math.cos(t), Math.sin(t)], c.line, 'front');

    for (const it of items) if (it.depth >= 0) it.draw();

    // The trail of the main arrow's tip, fading into the past.
    const tr = scene.trail || [];
    if (tr.length > 1) {
      ctx.lineWidth = 1.6;
      for (let i = 1; i < tr.length; i++) {
        const a = this.P(tr[i - 1]), b = this.P(tr[i]);
        ctx.globalAlpha = (0.15 + 0.75 * (i / tr.length)) * (b[2] < 0 ? 0.45 : 1);
        ctx.strokeStyle = c.trail;
        ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    // The cone swept by a spin precessing too fast to draw one arrow.
    if (scene.cone && !this.narrow(scene.cone)) this.drawCone(ctx, scene.cone, c);

    if (scene.coil) this.coil(ctx, c, 'front', coilAxis, scene.coilHover);

    // The main arrow and its projections.
    const m = scene.sum;
    if (m) {
      const len = Math.hypot(m[0], m[1], m[2]);
      if (scene.projections && len > 0.02) {
        const foot = [m[0], m[1], 0], o = this.P([0, 0, 0]), F = this.P(foot), T = this.P(m), Z = this.P([0, 0, m[2]]);
        ctx.setLineDash([4, 4]); ctx.lineWidth = 1.2;
        ctx.strokeStyle = c.ink3;
        ctx.beginPath(); ctx.moveTo(T[0], T[1]); ctx.lineTo(F[0], F[1]); ctx.moveTo(T[0], T[1]); ctx.lineTo(Z[0], Z[1]); ctx.stroke();
        ctx.setLineDash([]);
        ctx.lineWidth = 3;
        ctx.strokeStyle = c.mxy; ctx.globalAlpha = 0.9;
        ctx.beginPath(); ctx.moveTo(o[0], o[1]); ctx.lineTo(F[0], F[1]); ctx.stroke();
        ctx.strokeStyle = c.mz;
        ctx.beginPath(); ctx.moveTo(o[0], o[1]); ctx.lineTo(Z[0], Z[1]); ctx.stroke();
        ctx.globalAlpha = 1;
      }
      if (!scene.cone || this.narrow(scene.cone)) this.arrow(ctx, m, c.m, scene.sumWidth ?? 4, 12, 1, [0, 0, 0], 0.8);
      if (scene.tipHover && len > 0.05) {
        const T = this.P(m);
        ctx.strokeStyle = c.m; ctx.lineWidth = 1.5; ctx.globalAlpha = 0.6;
        ctx.beginPath(); ctx.arc(T[0], T[1], 11, 0, 2 * Math.PI); ctx.stroke(); ctx.globalAlpha = 1;
      }
    }
    ctx.restore();
  }

  /** Eight turns of a coil round its axis n (a unit vector in the x–z plane: x̂ by default),
   *  outside the sphere: the near or the far halves; `hot` draws its ends' handles brighter. */
  coil(ctx, c, half, n = [1, 0, 0], hot = false) {
    // Two directions square to the axis: ŷ, and n × ŷ.
    const e1 = [0, 1, 0], e2 = [-n[2], 0, n[0]];
    ctx.save();
    ctx.globalAlpha = half === 'front' ? 0.55 : 0.35;
    for (const x of [-1.05, -0.75, -0.45, -0.15, 0.15, 0.45, 0.75, 1.05]) {
      ctx.strokeStyle = c.coil; ctx.lineWidth = 1.6;
      ctx.beginPath();
      let on = false;
      for (let k = 0; k <= 72; k++) {
        const t = (2 * Math.PI * k) / 72, a = 1.08 * Math.cos(t), b = 1.08 * Math.sin(t);
        const p = this.P([x * n[0] + a * e1[0] + b * e2[0], x * n[1] + a * e1[1] + b * e2[1], x * n[2] + a * e1[2] + b * e2[2]]), vis = half === 'front' ? p[2] >= 0 : p[2] < 0;
        if (vis) { if (on) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]); on = true; } else on = false;
      }
      ctx.stroke();
    }
    if (half === 'front') {
      // The coil's axis, dashed, and a handle at each end to turn it by.
      const a = this.P(n.map((v) => -1.3 * v)), b = this.P(n.map((v) => 1.3 * v));
      ctx.globalAlpha = hot ? 0.95 : 0.6; ctx.strokeStyle = c.coil; ctx.lineWidth = 1.2; ctx.setLineDash([5, 4]);
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = c.coil;
      for (const p of [a, b]) { ctx.beginPath(); ctx.arc(p[0], p[1], hot ? 6.5 : 5, 0, 2 * Math.PI); ctx.fill(); }
    }
    ctx.restore();
  }

  /** The screen points of the coil's two end handles (axis n). */
  coilEnds(n) { return [this.P(n.map((v) => 1.3 * v)), this.P(n.map((v) => -1.3 * v))]; }

  /**
   * The angle from ẑ (0 to π/2: a coil's two ends are the same coil) of the direction in the x–z
   * plane that the screen point (X, Y) lies along, seen from the sphere's centre: the screen
   * offset is written as a x̂ + b ẑ on the screen.  Null where x̂ and ẑ fall on one line.
   */
  angleXZ(X, Y) {
    const o = this.P([0, 0, 0]), px = this.P([1, 0, 0]), pz = this.P([0, 0, 1]);
    const ux = px[0] - o[0], uy = px[1] - o[1], vx = pz[0] - o[0], vy = pz[1] - o[1], qx = X - o[0], qy = Y - o[1];
    const det = ux * vy - uy * vx;
    if (Math.abs(det) < 0.15 * Math.hypot(ux, uy) * Math.hypot(vx, vy)) return null;
    const a = (qx * vy - qy * vx) / det, b = (ux * qy - uy * qx) / det;
    return Math.atan2(Math.abs(a), Math.abs(b));
  }

  /** A great circle (or any closed curve) given by f(t), its near or far half. */
  circle(ctx, f, color, half) {
    ctx.save();
    ctx.strokeStyle = color; ctx.lineWidth = half === 'front' ? 1.2 : 1;
    if (half === 'back') { ctx.setLineDash([3, 4]); ctx.globalAlpha = 0.6; }
    ctx.beginPath();
    let on = false;
    for (let k = 0; k <= 96; k++) {
      const p = this.P(f((2 * Math.PI * k) / 96)), vis = half === 'front' ? p[2] >= 0 : p[2] < 0;
      if (vis) { if (on) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]); on = true; } else on = false;
    }
    ctx.stroke();
    ctx.restore();
  }

  axis(ctx, a, L, label, c, beside) {
    const o = this.P([0, 0, 0]), p = this.P(a.map((x) => x * L)), n = this.P(a.map((x) => -x * 1.0));
    ctx.save();
    ctx.strokeStyle = c.ink3; ctx.lineWidth = 1;
    ctx.globalAlpha = 0.8;
    ctx.beginPath(); ctx.moveTo(n[0], n[1]); ctx.lineTo(p[0], p[1]); ctx.stroke();
    ctx.globalAlpha = 1;
    const q = this.P(a.map((x) => x * (L + 0.1)));
    ctx.fillStyle = c.ink2; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    if (beside) ctx.fillText(label, p[0] - 12, p[1] + 4);
    else ctx.fillText(label, q[0] + (q[0] - o[0]) * 0.02, q[1] + (q[1] - o[1]) * 0.02);
    ctx.restore();
  }

  /** An arrow from the origin to v: a line and a head in the screen plane. */
  arrow(ctx, v, color, width, head, alpha = 1, from = [0, 0, 0], behind = 0.55) {
    const o = this.P(from), t = this.P([from[0] + v[0], from[1] + v[1], from[2] + v[2]]);
    const dx = t[0] - o[0], dy = t[1] - o[1], l = Math.hypot(dx, dy);
    ctx.save();
    ctx.globalAlpha = alpha * (t[2] < -0.05 ? behind : 1);
    ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = width;
    if (l < 1) { ctx.beginPath(); ctx.arc(t[0], t[1], width, 0, 2 * Math.PI); ctx.fill(); ctx.restore(); return; }
    const ux = dx / l, uy = dy / l, h = Math.min(head, l * 0.5);
    ctx.beginPath(); ctx.moveTo(o[0], o[1]); ctx.lineTo(t[0] - ux * h * 0.6, t[1] - uy * h * 0.6); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(t[0], t[1]);
    ctx.lineTo(t[0] - ux * h - uy * h * 0.45, t[1] - uy * h + ux * h * 0.45);
    ctx.lineTo(t[0] - ux * h + uy * h * 0.45, t[1] - uy * h - ux * h * 0.45);
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  fieldArrow(ctx, f, c) {
    ctx.save();
    if (f.dash) ctx.setLineDash(f.dash);
    this.arrow(ctx, f.v, f.color, f.width ?? 2.2, 10, f.alpha ?? 1, f.from || [0, 0, 0]);
    ctx.setLineDash([]);
    if (f.label) {
      const from = f.from || [0, 0, 0], tip = [from[0] + f.v[0], from[1] + f.v[1], from[2] + f.v[2]];
      const l = Math.hypot(...f.v) || 1, p = this.P(tip.map((x, i) => x + (f.v[i] / l) * 0.12));
      ctx.font = '600 13px system-ui, sans-serif';
      ctx.fillStyle = f.color; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(f.label, p[0] + (f.dx || 0), p[1] + (f.dy || 0));
    }
    ctx.restore();
  }

  /** A cone too narrow to see: the arrow lies along its axis, and is drawn as it is. */
  narrow(cone) {
    const { axis: n, v } = cone, l = Math.hypot(...v) || 1, a = (v[0] * n[0] + v[1] * n[1] + v[2] * n[2]) / l;
    return a > Math.cos(0.12);
  }

  /** The cone a vector v sweeps precessing about the unit axis n. */
  drawCone(ctx, cone, c) {
    const { axis: n, v } = cone;
    const a = v[0] * n[0] + v[1] * n[1] + v[2] * n[2];
    const p = [v[0] - a * n[0], v[1] - a * n[1], v[2] - a * n[2]], r = Math.hypot(...p);
    if (r < 1e-3) return;
    const e1 = p.map((x) => x / r), e2 = [n[1] * e1[2] - n[2] * e1[1], n[2] * e1[0] - n[0] * e1[2], n[0] * e1[1] - n[1] * e1[0]];
    const pts = [];
    for (let k = 0; k <= 64; k++) {
      const t = (2 * Math.PI * k) / 64, cs = Math.cos(t) * r, sn = Math.sin(t) * r;
      pts.push(this.P([a * n[0] + cs * e1[0] + sn * e2[0], a * n[1] + cs * e1[1] + sn * e2[1], a * n[2] + cs * e1[2] + sn * e2[2]]));
    }
    const o = this.P([0, 0, 0]);
    ctx.save();
    ctx.fillStyle = c.cone; ctx.globalAlpha = 0.22;
    ctx.beginPath(); ctx.moveTo(o[0], o[1]);
    for (const q of pts) ctx.lineTo(q[0], q[1]);
    ctx.closePath(); ctx.fill();
    ctx.globalAlpha = 1; ctx.strokeStyle = c.m; ctx.lineWidth = 2.5;
    ctx.beginPath();
    pts.forEach((q, i) => (i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1])));
    ctx.stroke();
    ctx.restore();
  }
}
