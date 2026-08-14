import { dial10, fieldHash01 } from "./field.js";

/* sampling: the shared deterministic sampling core. Every formation that
 * scatters points over triangles runs the same three steps: pick a triangle
 * against an area-weighted CDF, fold two hash draws into uniform barycentric
 * coordinates, and add a little per-point jitter. One copy here keeps the
 * hash streams identical across field-shapes and field-face.
 *
 * The diffusion dial lives here too, for the same reason: it is the scatter
 * jitterAt applies, and one definition is what makes `diffusion` mean the same
 * world units on a torus knot, a helix and a flower alike.
 *
 * No three: plain arithmetic over typed arrays, so the face path stays free
 * of the heavy module. */

/* the diffusion dial's internal spread, in world units: how far a point may sit
 * off the surface it was drawn from. 0 is a perfectly crisp shell (every point
 * exactly on its surface), 0.02 the tuned nominal that reads as dust rather
 * than a mesh, and 0.12 the softest silhouette that is still the shape (past it
 * a 2.2-radius object starts reading as a haze). Where chaos moves a point every
 * frame, this moves it ONCE, at build time.
 *
 * ONE range for every formation that takes the dial, so a host learns the world
 * units once and they hold everywhere. The face is the one deliberate exception
 * and says why on its own constants: a head carries its silhouette in small
 * features, so it tops out far below this. */
const DIFFUSION_MIN = 0;
const DIFFUSION_NOMINAL = 0.02;
const DIFFUSION_MAX = 0.12;

/** the diffusion dial (0..10, 5 the tuned nominal) as its world-unit spread:
 * the half-width jitterAt scatters a point off the surface it belongs to. */
export function diffusionSpread(diffusion: number): number {
  return dial10(diffusion, DIFFUSION_MIN, DIFFUSION_NOMINAL, DIFFUSION_MAX);
}

/** index of the first `cum` entry >= r (r drawn in 0..cum[last]) */
export function pickFromCdf(cum: Float64Array, r: number): number {
  let lo = 0;
  let hi = cum.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] < r) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

// reused result cell: build loops run per point and must not allocate
const BARY: [number, number] = [0, 0];

/** Uniform barycentric coordinates for point i: two deterministic draws folded
 * from the unit square onto the triangle (u + v <= 1). `uOff`/`vOff` shift the
 * hash streams so a multi-part caller decorrelates per part. Returns a shared
 * cell; read it before the next call. */
export function baryAt(
  i: number,
  seed: number,
  uOff = 0,
  vOff = 0,
): readonly [number, number] {
  let u = fieldHash01(i * 13 + seed * 3 + uOff + 1);
  let v = fieldHash01(i * 17 + seed * 5 + vOff + 2);
  if (u + v > 1) {
    u = 1 - u;
    v = 1 - v;
  }
  BARY[0] = u;
  BARY[1] = v;
  return BARY;
}

/** per-point scatter on axis k (1, 2, 3): plus or minus `amount` world units */
export function jitterAt(i: number, seed: number, k: number, amount: number): number {
  return (fieldHash01(i * 23 + seed * 7 + k) - 0.5) * 2 * amount;
}
