import * as THREE from "three";
import { fieldHash01, type FieldFormation } from "./field.js";
import { baryAt, diffusionSpread, jitterAt, pickFromCdf } from "./sampling.js";

/* field-shapes: the three.js adapter for DsField: turn ANY BufferGeometry
 * (built-ins, extrusions, loaded models' geometry) into a FieldFormation by
 * sampling points uniformly across its surface. Multi-part shapes compose from
 * a list of geometries with per-part transform and density weight. The engine
 * stays untouched: a shape is just a formation whose build ignores the
 * viewport.
 *
 * Heavy module (imports three): keep it behind the same lazy, client-only
 * split as the engine, exactly like field.tsx itself.
 *
 * The sampler is deterministic (the engine's fieldHash01, seeded per point),
 * so the same geometry and count always scatter the same way: morphs are
 * stable across renders and there is no Math.random in the pipeline. */

const A = new THREE.Vector3();
const B = new THREE.Vector3();
const C = new THREE.Vector3();
const AB = new THREE.Vector3();
const AC = new THREE.Vector3();
const V = new THREE.Vector3();

/** The area-weighted cumulative distribution over a non-indexed position
 * attribute's triangles, and the total area it ends on: the table pickFromCdf
 * draws against, so a triangle catches points in proportion to its own area. */
function triangleCdf(pos: THREE.BufferAttribute): { cum: Float64Array; total: number } {
  const triCount = Math.floor(pos.count / 3);
  const cum = new Float64Array(triCount);
  let total = 0;
  for (let t = 0; t < triCount; t++) {
    A.fromBufferAttribute(pos, t * 3);
    B.fromBufferAttribute(pos, t * 3 + 1);
    C.fromBufferAttribute(pos, t * 3 + 2);
    AB.subVectors(B, A);
    AC.subVectors(C, A);
    total += AB.cross(AC).length() * 0.5;
    cum[t] = total;
  }
  return { cum, total };
}

/** The point at barycentric (u, v) of triangle `tri`, into `target`. */
function triPoint(
  pos: THREE.BufferAttribute,
  tri: number,
  u: number,
  v: number,
  target: THREE.Vector3,
): void {
  A.fromBufferAttribute(pos, tri * 3);
  B.fromBufferAttribute(pos, tri * 3 + 1);
  C.fromBufferAttribute(pos, tri * 3 + 2);
  target.set(
    A.x + (B.x - A.x) * u + (C.x - A.x) * v,
    A.y + (B.y - A.y) * u + (C.y - A.y) * v,
    A.z + (B.z - A.z) * u + (C.z - A.z) * v,
  );
}

/** Sample `count` points uniformly over a geometry's surface (area-weighted
 * triangle pick + uniform barycentric spread). Returns xyz triplets in the
 * geometry's own coordinate space. */
export function sampleGeometrySurface(
  geometry: THREE.BufferGeometry,
  count: number,
  seed = 1,
): Float32Array {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  const pos = g.getAttribute("position") as THREE.BufferAttribute;
  const { cum, total } = triangleCdf(pos);

  const out = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const lo = pickFromCdf(cum, fieldHash01(i * 7 + seed) * total);
    const [u, v] = baryAt(i, seed);
    triPoint(pos, lo, u, v, V);
    out[i * 3] = V.x;
    out[i * 3 + 1] = V.y;
    out[i * 3 + 2] = V.z;
  }

  if (g !== geometry) g.dispose(); // the non-indexed copy was ours
  return out;
}

/** one piece of a composed shape */
export type ShapePart = {
  geometry: THREE.BufferGeometry;
  /** translate */
  at?: [number, number, number];
  /** radians, applied tilt-then-azimuth (Euler YXZ) */
  rot?: [number, number, number];
  /** uniform or per-axis; note the density split doesn't re-weigh scaled area,
   * use `weight` to compensate */
  scale?: number | [number, number, number];
  /** sampling density multiplier on top of the part's surface area (>1 makes
   * a small part read denser and brighter, e.g. an emblem on a coin face) */
  weight?: number;
};

export type ShapeOpts = {
  count: number;
  /** world radius the merged cloud is scaled to fit */
  radius?: number;
  /** vertical center offset in world units */
  y?: number;
  /** edge diffusion dial, 0..10 (default 5): how far sampled points scatter off
   *  the surface, which is what makes the silhouette read crisp or soft. 0 is a
   *  perfectly crisp surface, 5 the tuned 0.02 world units, 10 the softest
   *  (0.12) that still holds the shape. The same dial, in the same world units,
   *  that every 3D formation takes. A BUILD input, not a live one: it is
   *  baked into the point positions, so changing it means a new factory call
   *  and a rebuild, which the engine takes into the live cloud in place (no
   *  remount, no reshuffle: every point keeps its own surface anchor and only
   *  its offset from it scales). Register two diffusions as two formations and
   *  the switch between them is a real staggered morph, the way two radii of one
   *  shape are. */
  diffusion?: number;
  seed?: number;
} & Omit<FieldFormation, "build">;

/** the sampled surface of ONE geometry: the non-indexed copy pointAt reads on
 * every build, plus its area-weighted triangle CDF */
type Surface = { pos: THREE.BufferAttribute; cum: Float64Array; total: number };

/* Cached per SOURCE geometry, not per part: a composition can repeat the same
 * geometry dozens of times (the demo galaxy's arms are 96 copies of one blob)
 * and the part transform lives in the matrix, so the triangles and their areas
 * are identical. Weak, so the copy dies with the geometry it came from. */
const surfaces = new WeakMap<THREE.BufferGeometry, Surface>();

const surfaceOf = (geometry: THREE.BufferGeometry): Surface => {
  const hit = surfaces.get(geometry);
  if (hit) return hit;
  // the non-indexed copy stays alive: pointAt reads it on every build
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  const pos = g.getAttribute("position") as THREE.BufferAttribute;
  const surface = { pos, ...triangleCdf(pos) };
  surfaces.set(geometry, surface);
  return surface;
};

/** Compose a FieldFormation from a list of transformed geometries. Sampling is
 * PER INDEX: each index hashes into a part (against the weighted-area CDF) and
 * then into a triangle, so the i-th point is identical at every count
 * (prefix-stable: a count knob leaves existing dots in place and only adds or
 * removes) and parts interleave across the index space (no contiguous index
 * blocks to fly as coherent sheets during morphs). The merged cloud recenters
 * and scales to `radius` world units via a fixed probe, and `diffusion` scatters
 * each point off its surface so the shell reads as dust rather than a mesh.
 * Formation personality passes through. */
export function composedFormation(
  parts: ShapePart[],
  { count, radius = 2.2, y = 0.1, diffusion = 5, seed = 1, ...personality }: ShapeOpts,
): FieldFormation {
  // the dial resolves ONCE, at factory time: it is geometry, not a per-frame
  // amount, and the build loop must stay free of anything it can hoist
  const spread = diffusionSpread(diffusion);
  type PartData = {
    pos: THREE.BufferAttribute;
    cum: Float64Array;
    total: number;
    matrix: THREE.Matrix4;
  };
  let datas: PartData[] | null = null;
  let wcum: Float64Array | null = null;
  let norm: { cx: number; cy: number; cz: number; s: number } | null = null;

  // the point for a global index, in merged (pre-normalization) space: the same
  // weighted-CDF draw twice over, first for the part and then for its triangle
  const pointAt = (i: number, target: THREE.Vector3) => {
    const wc = wcum!;
    const wTotal = wc[wc.length - 1] || 1;
    const p = pickFromCdf(wc, fieldHash01(i * 43 + seed * 11) * wTotal);
    const d = datas![p];
    const lo = pickFromCdf(d.cum, fieldHash01(i * 7 + seed + p * 97) * d.total);
    // the per-part offsets decorrelate the barycentric streams across parts
    const [u, v] = baryAt(i, seed, p * 31, p * 61);
    triPoint(d.pos, lo, u, v, target);
    target.applyMatrix4(d.matrix);
  };

  const prep = () => {
    if (datas) return;
    const E = new THREE.Euler();
    const Q = new THREE.Quaternion();
    const S = new THREE.Vector3();
    const P = new THREE.Vector3();
    datas = parts.map((p) => {
      const { pos, cum, total } = surfaceOf(p.geometry);
      P.set(...(p.at ?? [0, 0, 0]));
      const [ex, ey, ez] = p.rot ?? [0, 0, 0];
      E.set(ex, ey, ez, "YXZ"); // tilt (x) first, then azimuth (y)
      Q.setFromEuler(E);
      const sc = p.scale ?? 1;
      if (typeof sc === "number") S.set(sc, sc, sc);
      else S.set(...sc);
      return { pos, cum, total, matrix: new THREE.Matrix4().compose(P, Q, S) };
    });
    wcum = new Float64Array(parts.length);
    let w = 0;
    datas.forEach((d, i) => {
      w += d.total * (parts[i].weight ?? 1);
      wcum![i] = w;
    });
    // normalization from a FIXED probe, so the transform never depends on the
    // live count: a count change cannot rescale or re-center existing dots
    const PROBE = 2048;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i < PROBE; i++) {
      pointAt(i, V);
      if (V.x < minX) minX = V.x;
      if (V.x > maxX) maxX = V.x;
      if (V.y < minY) minY = V.y;
      if (V.y > maxY) maxY = V.y;
      if (V.z < minZ) minZ = V.z;
      if (V.z > maxZ) maxZ = V.z;
    }
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const cz = (minZ + maxZ) / 2;
    let maxR2 = 0;
    for (let i = 0; i < PROBE; i++) {
      pointAt(i, V);
      const dx = V.x - cx;
      const dy = V.y - cy;
      const dz = V.z - cz;
      const r2 = dx * dx + dy * dy + dz * dz;
      if (r2 > maxR2) maxR2 = r2;
    }
    norm = { cx, cy, cz, s: maxR2 > 0 ? radius / Math.sqrt(maxR2) : 1 };
  };

  return {
    ...personality,
    // a shape is intrinsic: the build ignores the viewport
    build: (): Float32Array => {
      prep();
      const { cx, cy, cz, s } = norm!;
      const out = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) {
        pointAt(i, V);
        out[i * 3] = (V.x - cx) * s + jitterAt(i, seed, 1, spread);
        out[i * 3 + 1] = (V.y - cy) * s + y + jitterAt(i, seed, 2, spread);
        out[i * 3 + 2] = (V.z - cz) * s + jitterAt(i, seed, 3, spread);
      }
      return out;
    },
  };
}

/** Wrap a single three.js geometry as a ready FieldFormation (the one-part
 * case of composedFormation). */
export function geometryFormation(
  geometry: THREE.BufferGeometry,
  opts: ShapeOpts,
): FieldFormation {
  return composedFormation([{ geometry }], opts);
}
