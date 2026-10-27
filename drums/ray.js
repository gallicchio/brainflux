// A classical particle in the billiard: straight lines, specular reflection at the wall.  The
// wall is the zero level of the shape's signed distance sdf(x, y) (positive inside); a hit is
// found by marching in short steps and bisecting, and the normal is the gradient of sdf there.
// No DOM.

export class Ray {
  /**
   * sdf: the shape; (x, y) start; (dx, dy) direction; speed (box units per unit time);
   * stepLen: the marching step (a fraction of a grid step).
   */
  constructor(sdf, x, y, dx, dy, speed, stepLen) {
    this.sdf = sdf;
    const L = Math.hypot(dx, dy) || 1;
    this.x = x; this.y = y; this.dx = dx / L; this.dy = dy / L;
    this.speed = speed;
    this.stepLen = stepLen;
    this.path = [[x, y]];      // the bounce points so far, and (implicitly) the current position
    this.bounces = 0;
    this.maxPath = 400;
  }
  normal(x, y) {
    const e = 1e-6, f = this.sdf;
    const gx = (f(x + e, y) - f(x - e, y)) / (2 * e), gy = (f(x, y + e) - f(x, y - e)) / (2 * e);
    const L = Math.hypot(gx, gy) || 1;
    return [gx / L, gy / L]; // points inwards
  }
  /** Move on by time dt, bouncing as needed. */
  advance(dt) {
    let left = this.speed * dt, guard = 0;
    while (left > 0 && guard++ < 10000) {
      const s = Math.min(this.stepLen, left);
      const nx = this.x + s * this.dx, ny = this.y + s * this.dy;
      if (this.sdf(nx, ny) > 0) { this.x = nx; this.y = ny; left -= s; continue; }
      // The wall lies between here and there: bisect for it.
      let a = 0, b = s;
      for (let k = 0; k < 40; k++) {
        const c = 0.5 * (a + b);
        if (this.sdf(this.x + c * this.dx, this.y + c * this.dy) > 0) a = c; else b = c;
      }
      const hx = this.x + a * this.dx, hy = this.y + a * this.dy;
      left -= a;
      const [ux, uy] = this.normal(hx, hy);
      const vn = this.dx * ux + this.dy * uy;
      if (vn < 0) { this.dx -= 2 * vn * ux; this.dy -= 2 * vn * uy; }
      else { this.dx = -this.dx; this.dy = -this.dy; } // a corner: turn back
      const L = Math.hypot(this.dx, this.dy);
      this.dx /= L; this.dy /= L;
      this.x = hx; this.y = hy;
      // Step off the wall a little, along the inward normal, so the next step starts inside.
      for (let k = 0; k < 8 && this.sdf(this.x, this.y) <= 0; k++) { this.x += 1e-7 * ux * 2 ** k; this.y += 1e-7 * uy * 2 ** k; }
      this.path.push([hx, hy]);
      if (this.path.length > this.maxPath) this.path.splice(0, this.path.length - this.maxPath);
      this.bounces++;
      if (left < 1e-12) break;
    }
  }
}
