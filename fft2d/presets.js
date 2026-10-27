// The gallery: things worth transforming.  Each preset fills an n x n complex image on one side
// (x: the image, k: the transform).  Lengths are fractions of n, so a preset looks the same at
// every resolution, and `size` scales the shapes (bigger in x means smaller in k: the
// similarity theorem).  Coordinates: pixel (i, j), column i and row j, is the point
// x = i - n/2, y = n/2 - j, so y points up and the origin is the centre pixel.

function grid(n, f) {
  const re = new Float64Array(n * n), im = new Float64Array(n * n);
  for (let j = 0; j < n; j++) {
    const y = n / 2 - j;
    for (let i = 0; i < n; i++) {
      const v = f(i - n / 2, y);
      if (typeof v === 'number') re[j * n + i] = v;
      else if (v) { re[j * n + i] = v[0]; im[j * n + i] = v[1]; }
    }
  }
  return [re, im];
}

// A shape sampled 4 x 4 times in every pixel, so that its edge is a ramp of greys.  A disk drawn
// with whole pixels is an octagon at low resolution, and so are the rings of its transform.
function smooth(n, inside) {
  const S = 4;
  return grid(n, (x, y) => {
    let c = 0;
    for (let a = 0; a < S; a++) for (let b = 0; b < S; b++) c += inside(x + (a + 0.5) / S - 0.5, y + (b + 0.5) / S - 0.5);
    return c / (S * S);
  });
}

// Draw with the 2D canvas (text, bricks) and read back the grey levels.
function rasterize(n, draw) {
  const c = document.createElement('canvas');
  c.width = c.height = n;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, n, n);
  ctx.fillStyle = '#fff'; ctx.strokeStyle = '#fff';
  draw(ctx, n);
  return grey(ctx.getImageData(0, 0, n, n).data, n);
}

function grey(data, n) {
  const re = new Float64Array(n * n), im = new Float64Array(n * n);
  for (let i = 0; i < n * n; i++) re[i] = (data[4 * i] + data[4 * i + 1] + data[4 * i + 2]) / 765;
  return [re, im];
}

const images = new Map();
export function loadImage(url) {
  if (!images.has(url)) {
    images.set(url, new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`could not load ${url}`));
      img.src = url;
    }));
  }
  return images.get(url);
}

/**
 * Grey levels of an image (or video frame) at n x n.
 *   fit:  the largest centred square, scaled to n x n
 *   crop: the centred n x n pixels at their own scale (fine texture stays fine), scaled down
 *         only if the image is smaller than n
 */
export function imageData(source, n, how = 'fit') {
  const w = source.videoWidth || source.naturalWidth || source.width;
  const h = source.videoHeight || source.naturalHeight || source.height;
  const c = document.createElement('canvas');
  c.width = c.height = n;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  const side = Math.min(w, h);
  if (how === 'crop' && side >= n) {
    ctx.drawImage(source, (w - n) / 2, (h - n) / 2, n, n, 0, 0, n, n);
  } else {
    ctx.drawImage(source, (w - side) / 2, (h - side) / 2, side, side, 0, 0, n, n);
  }
  return grey(ctx.getImageData(0, 0, n, n).data, n);
}

const gauss = (n, s) => grid(n, (x, y) => Math.exp(-(x * x + y * y) / (2 * (0.04 * n * s) ** 2)));

export const PRESETS = [
  { id: 'portrait', label: 'Fourier', title: 'Joseph Fourier, engraved by Geille after a drawing by J. Boilly (public domain)',
    side: 'x', image: 'images/fourier-portrait.png', how: 'fit' },
  { id: 'jacket', label: 'His jacket', title: "The hatching on Fourier's jacket, pixel for pixel: stripes of one spacing and direction become a few bright spots in the transform",
    side: 'x', image: 'images/fourier-jacket.png', how: 'crop' },
  { id: 'gaussian', label: 'Gaussian', title: 'A Gaussian transforms into a Gaussian; the narrower one side, the wider the other',
    side: 'x', sized: true, make: gauss },
  { id: 'box', label: 'Square', title: 'A square transforms into sinc(kx) sinc(ky): a bright centre with lobes along the axes',
    side: 'x', sized: true, make: (n, s) => grid(n, (x, y) => +(Math.max(Math.abs(x), Math.abs(y)) < 0.06 * n * s)) },
  { id: 'disk', label: 'Disk', title: 'A disk transforms into the Airy pattern: rings around a bright centre (the diffraction pattern of a round aperture)',
    side: 'x', sized: true, make: (n, s) => smooth(n, (x, y) => x * x + y * y < (0.1 * n * s) ** 2) },
  { id: 'ring', label: 'Ring', title: 'A thin ring transforms into a Bessel function J0(kR): rings in both',
    side: 'x', sized: true, make: (n, s) => grid(n, (x, y) => { const r = Math.hypot(x, y), R = 0.18 * n * s; return Math.exp(-((r - R) ** 2) / 1.5); }) },
  { id: 'slit', label: 'Slit', title: 'A long narrow slit: its transform is narrow along the slit and wide across it',
    side: 'x', sized: true, make: (n, s) => grid(n, (x, y) => +(Math.abs(x) < Math.max(0.5, 0.015 * n * s) && Math.abs(y) < 0.3 * n)) },
  { id: 'double', label: 'Double slit', title: "Two slits: the single slit's pattern crossed by fringes whose spacing is set by the slits' separation",
    side: 'x', sized: true, make: (n, s) => grid(n, (x, y) => {
      const d = 0.08 * n * s, w = Math.max(0.5, 0.012 * n);
      return +((Math.abs(x - d / 2) < w || Math.abs(x + d / 2) < w) && Math.abs(y) < 0.3 * n);
    }) },
  { id: 'grating', label: 'Grating', title: 'Seven slits: the fringes sharpen into the bright orders of a diffraction grating',
    side: 'x', sized: true, make: (n, s) => grid(n, (x, y) => {
      const d = 0.05 * n * s, w = Math.max(0.5, 0.008 * n);
      let on = 0;
      for (let m = -3; m <= 3; m++) if (Math.abs(x - m * d) < w) on = 1;
      return on * (Math.abs(y) < 0.3 * n);
    }) },
  { id: 'points', label: 'Two points', title: 'Two points transform into cosine stripes: the two-slit fringes without the envelope',
    side: 'x', sized: true, make: (n, s) => grid(n, (x, y) => { const d = Math.round(0.06 * n * s); return +(y === 0 && (x === d || x === -d)); }) },
  { id: 'stripes', label: 'Stripes', title: 'A cosine grating: two bright points in the transform, at plus and minus its wavevector',
    side: 'x', sized: true, make: (n, s) => grid(n, (x, y) => 0.5 + 0.5 * Math.cos((2 * Math.PI * (x * 0.8 + y * 0.6)) / (0.08 * n * s))) },
  { id: 'lattice', label: 'Lattice', title: 'A square lattice of dots (a crystal) transforms into its reciprocal lattice',
    side: 'x', sized: true, make: (n, s) => {
      const a = Math.max(2, Math.round(0.0625 * n * s));
      return grid(n, (x, y) => {
        const dx = ((x % a) + a + a / 2) % a - a / 2, dy = ((y % a) + a + a / 2) % a - a / 2;
        return Math.exp(-(dx * dx + dy * dy) / (2 * (0.012 * n) ** 2)) * Math.exp(-(x * x + y * y) / (2 * (0.3 * n) ** 2));
      });
    } },
  { id: 'hexagonal', label: 'Hexagonal', title: 'A triangular lattice (like the atoms of a close-packed layer); its reciprocal lattice is triangular too, rotated by 30°',
    side: 'x', sized: true, make: (n, s) => {
      const a = 0.07 * n * s, sigma = 0.012 * n, out = [new Float64Array(n * n), new Float64Array(n * n)];
      const h = (a * Math.sqrt(3)) / 2;
      for (let r = -Math.ceil(n / h); r <= Math.ceil(n / h); r++) {
        for (let c = -Math.ceil(n / a) - 1; c <= Math.ceil(n / a) + 1; c++) {
          const cx = c * a + (r & 1 ? a / 2 : 0), cy = r * h;
          const env = Math.exp(-(cx * cx + cy * cy) / (2 * (0.3 * n) ** 2));
          if (env < 1e-3) continue;
          for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
            const px = Math.round(cx) + dx + n / 2, py = n / 2 - Math.round(cy) - dy;
            if (px < 0 || py < 0 || px >= n || py >= n) continue;
            const ex = px - n / 2 - cx, ey = n / 2 - py - cy;
            out[0][py * n + px] += env * Math.exp(-(ex * ex + ey * ey) / (2 * sigma * sigma));
          }
        }
      }
      return out;
    } },
  { id: 'bricks', label: 'Bricks', title: 'A brick wall: a lattice with a two-brick basis, so some reciprocal-lattice spots go dark',
    side: 'x', sized: true, make: (n, s) => rasterize(n, (ctx) => {
      const bw = Math.max(4, 0.125 * n * s), bh = bw / 2, m = Math.max(1, n / 128);
      let seed = 3;
      const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      for (let r = 0, y = -bh; y < n + bh; r++, y += bh) {
        for (let x = -bw + (r % 2 ? bw / 2 : 0); x < n + bw; x += bw) {
          const g = Math.round(150 + 80 * rnd());
          ctx.fillStyle = `rgb(${g},${g},${g})`;
          ctx.fillRect(x + m, y + m, bw - 2 * m, bh - 2 * m);
        }
      }
    }) },
  { id: 'text', label: 'Text', title: 'Letters: their straight strokes become streaks perpendicular to them',
    side: 'x', make: (n) => rasterize(n, (ctx) => {
      ctx.font = `italic ${Math.round(n * 0.2)}px Georgia, "Times New Roman", serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('Fourier', n / 2, n / 2);
    }) },
  { id: 'wave', label: 'One pixel of k', title: 'A single point in the transform is a single complex plane wave exp(i k·r): stripes of rotating phase',
    side: 'k', make: (n) => grid(n, (x, y) => (x === 5 && y === 3 ? n / 4 : 0)) },
  { id: 'author', label: 'The author', title: 'Jason Gallicchio, who wrote the original applet, around 2003',
    side: 'x', image: 'images/author.jpg', how: 'fit' },
];

/** Run a preset at resolution n: resolves to [re, im]. */
export async function makePreset(p, n, size = 1) {
  if (p.image) return imageData(await loadImage(p.image), n, p.how);
  return p.make(n, size);
}
