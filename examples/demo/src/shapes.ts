import * as THREE from "three";
import type { ShapePart } from "@0backlog/nebula";

/* Geometries for the shapes section, built once at module scope: a geometry is
 * immutable input to the sampler, so rebuilding it per render would only cost
 * memory. Any BufferGeometry works here, including one loaded from a model.
 * Sizes are nominal: the sampler normalizes every shape to the formation's
 * world radius, so only the proportions matter. Everything below is
 * deterministic; the only randomness in the pipeline is the sampler's own
 * seeded hash. */

export const KNOT_GEO = new THREE.TorusKnotGeometry(1.35, 0.42, 220, 32);
export const ICOSA_GEO = new THREE.IcosahedronGeometry(1, 0);

/* the solids: one three.js built-in each */

export const SPHERE_GEO = new THREE.SphereGeometry(1.5, 48, 32);
export const CUBE_GEO = new THREE.BoxGeometry(2, 2, 2);
// 4 radial segments make the cone a square pyramid; the eighth turn puts a
// face, not an edge, toward the camera
export const PYRAMID_GEO = new THREE.ConeGeometry(1.4, 1.8, 4).rotateY(Math.PI / 4);
export const OCTA_GEO = new THREE.OctahedronGeometry(1.4, 0);
export const DODECA_GEO = new THREE.DodecahedronGeometry(1.4, 0);
export const CAPSULE_GEO = new THREE.CapsuleGeometry(0.7, 1.3, 8, 24);
export const TORUS_GEO = new THREE.TorusGeometry(1.3, 0.45, 20, 48);
// an octahedron stretched tall reads as a cut gem; the scale bakes into the
// geometry so the sampler sees the final proportions
export const DIAMOND_GEO = new THREE.OctahedronGeometry(1.1, 0).scale(1, 1.5, 1);

/* the spring is one TubeGeometry along a sampled helix: five coils drawn as a
 * CatmullRom through enough points that the tube hugs the curve */
const springPath = (() => {
  const pts: THREE.Vector3[] = [];
  const COILS = 5;
  const STEPS = 120;
  for (let i = 0; i <= STEPS; i++) {
    const t = i / STEPS;
    const ang = t * COILS * Math.PI * 2;
    pts.push(new THREE.Vector3(Math.cos(ang) * 0.85, (t - 0.5) * 2.4, Math.sin(ang) * 0.85));
  }
  return new THREE.CatmullRomCurve3(pts);
})();
export const SPRING_GEO = new THREE.TubeGeometry(springPath, 240, 0.14, 10, false);

/* the mobius strip has no three.js built-in, so it is built by hand from its
 * parametric equation: a u x v grid of vertices, two triangles per cell. At
 * u = 2pi the equation lands on the u = 0 column with v flipped, so the plain
 * grid closes the loop, half twist included, on its own. */
function mobiusGeometry(R: number, w: number, uSeg: number, vSeg: number): THREE.BufferGeometry {
  const pos = new Float32Array((uSeg + 1) * (vSeg + 1) * 3);
  const idx: number[] = [];
  for (let iu = 0; iu <= uSeg; iu++) {
    const u = (iu / uSeg) * Math.PI * 2;
    for (let iv = 0; iv <= vSeg; iv++) {
      const v = (iv / vSeg - 0.5) * 2 * w;
      const p = (iu * (vSeg + 1) + iv) * 3;
      const mid = R + v * Math.cos(u / 2);
      pos[p] = mid * Math.cos(u);
      pos[p + 1] = mid * Math.sin(u);
      pos[p + 2] = v * Math.sin(u / 2);
    }
  }
  for (let iu = 0; iu < uSeg; iu++) {
    for (let iv = 0; iv < vSeg; iv++) {
      const a = iu * (vSeg + 1) + iv;
      const b = a + vSeg + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}
export const MOBIUS_GEO = mobiusGeometry(1.1, 0.4, 96, 6);

/* the ring leans on ShapePart's transform alone: one thin torus, tipped back
 * so the band reads as a hoop in depth rather than a flat outline */
export const RING_PARTS: ShapePart[] = [
  { geometry: new THREE.TorusGeometry(1.5, 0.09, 12, 64), rot: [0.55, 0, 0] },
];

/* saturn: a sphere and a flat annulus. The ring samples above its area's
 * share so it stays legible against the planet, and the tilt-then-azimuth
 * gives the classic three-quarter view before the cursor ever moves. */
export const SATURN_PARTS: ShapePart[] = [
  { geometry: new THREE.SphereGeometry(1, 32, 20) },
  { geometry: new THREE.RingGeometry(1.4, 2.2, 64), rot: [1.2, 0.4, 0], weight: 1.5 },
];

/* the atom leans on weight the way the coin does: a small nucleus at weight 6
 * so it reads as a dense core, and three thin orbits tipped by the same x tilt
 * then fanned a third of a turn apart in azimuth */
export const ATOM_PARTS: ShapePart[] = [
  { geometry: new THREE.SphereGeometry(0.34, 18, 12), weight: 6 },
  ...[0, 2.09, 4.19].map(
    (a): ShapePart => ({
      geometry: new THREE.TorusGeometry(1.5, 0.05, 8, 48),
      rot: [1.2, a, 0],
    }),
  ),
];

/* two cones tip to tip: the upper one flips over so both apexes meet at the
 * waist, capped bases as the end plates */
export const HOURGLASS_PARTS: ShapePart[] = [
  { geometry: new THREE.ConeGeometry(1, 1.6, 28), at: [0, -0.8, 0] },
  { geometry: new THREE.ConeGeometry(1, 1.6, 28), at: [0, 0.8, 0], rot: [Math.PI, 0, 0] },
];

/* the galaxy is parts all the way down: a flattened core plus a run of small
 * flattened blobs along each of two logarithmic spiral arms. All blobs share
 * ONE unit sphere; per-blob size rides the part scale. The density split
 * ignores scale (it weighs unscaled area), so each blob's weight is its scale
 * squared: the arms thin toward the tips instead of piling up there.
 *
 * The arms have to read as arms, not as strung beads, and that is a question
 * of SPACING, not of blob count alone: stepping the arm parameter evenly
 * strings the tip out, because a logarithmic spiral covers ground faster the
 * further out it goes. So the blobs step evenly along the ARC instead. On this
 * spiral both dr and r dtheta scale with r, so arc length is proportional to
 * r, which makes an even step in RADIUS an even step in arc: the whole
 * correction is one linear r. 48 stops then put the centers 0.070 apart along
 * an arc of 3.30, under two thirds of the radius of even the smallest blob, so
 * every blob overlaps its neighbours from the core out to the tip. */
const BLOB_GEO = new THREE.SphereGeometry(1, 10, 7);
const CORE_GEO = new THREE.SphereGeometry(0.5, 20, 14);
export const GALAXY_PARTS: ShapePart[] = (() => {
  const STOPS = 48; // blobs per arm
  const R0 = 0.42; // where an arm leaves the core
  const GROWTH = 1.3; // e^GROWTH is the arm's reach, in R0
  const REACH = Math.exp(GROWTH);
  const arms: ShapePart[] = [];
  let armWeight = 0;
  for (let arm = 0; arm < 2; arm++) {
    for (let k = 0; k < STOPS; k++) {
      const r = R0 * (1 + (k / (STOPS - 1)) * (REACH - 1)); // even along the arc
      const t = Math.log(r / R0) / GROWTH; // and back to the 0..1 arm parameter
      const ang = arm * Math.PI + t * 3.6; // just over half a turn per arm
      const s = 0.34 - t * 0.22; // blob radius shrinks toward the tip
      armWeight += s * s;
      arms.push({
        geometry: BLOB_GEO,
        at: [Math.cos(ang) * r, Math.sin(ang) * r, 0],
        scale: [s, s, s * 0.35],
        weight: s * s,
      });
    }
  }
  /* the core is solved against the arms rather than hand-set, so the blob
   * count stays a pure continuity knob: BLOB_GEO is a unit sphere (area 4pi)
   * and the core sphere has area pi, so four thirds of the arms' total weight
   * is a quarter of the shape's density, which is the share the core held when
   * the arms were 14 blobs each. Those are the nominal areas; the sampler
   * weighs the tessellated ones, and the 10x7 blob keeps less of its sphere
   * than the 20x14 core, so the built share is 25.8%. Neither figure moves
   * with the blob count. */
  return [
    { geometry: CORE_GEO, scale: [1, 1, 0.4], weight: (4 / 3) * armWeight },
    ...arms,
  ];
})();

/* the tornado is a stack of thin torus rings tapering into a funnel: wide at
 * the top, tight at the ground, each ring nudged off-axis on a slow
 * deterministic sway so the column doesn't read as a lathe. Per-ring radii are
 * real geometry (not scale), so sampling density follows circumference and the
 * funnel stays evenly dusted top to tip. */
export const TORNADO_PARTS: ShapePart[] = (() => {
  const RINGS = 12;
  const parts: ShapePart[] = [];
  for (let k = 0; k < RINGS; k++) {
    const t = k / (RINGS - 1); // 0 at the top rim, 1 at the ground
    parts.push({
      geometry: new THREE.TorusGeometry(1.35 - t * 1.15, 0.05, 8, 48),
      at: [Math.sin(t * 9) * 0.09, 1.1 - t * 2.2, Math.cos(t * 7) * 0.07],
      rot: [Math.PI / 2, 0, 0], // lay each ring flat, circling the y axis
    });
  }
  return parts;
})();

/* The rose is the composed example: it exercises both halves of ShapePart, the
 * per-part transform (at, rot, scale) and the density weight. weight > 1 makes
 * a small part read denser and brighter than its surface area alone would
 * earn, which is how the bud holds its own against the stem. */
export const ROSE_PARTS: ShapePart[] = [
  // bud, hugged by three inner petal shells
  {
    geometry: new THREE.SphereGeometry(0.5, 20, 14),
    at: [0, 1.62, 0],
    scale: [1, 1.2, 1],
    weight: 1.6,
  },
  ...[0, 2.09, 4.19].map(
    (a): ShapePart => ({
      geometry: new THREE.SphereGeometry(0.56, 16, 10, 0, Math.PI * 0.9, 0, Math.PI * 0.6),
      at: [Math.sin(a) * 0.12, 1.58, Math.cos(a) * 0.12],
      rot: [0.35, a, 0],
      weight: 1.3,
    }),
  ),
  // five outer petals, opened wider
  ...[0.63, 1.88, 3.14, 4.4, 5.65].map(
    (a): ShapePart => ({
      geometry: new THREE.SphereGeometry(0.62, 16, 10, 0, Math.PI, 0, Math.PI * 0.52),
      at: [Math.sin(a) * 0.26, 1.42, Math.cos(a) * 0.26],
      rot: [0.75, a, 0],
      weight: 1.15,
    }),
  ),
  // stem and two leaves
  { geometry: new THREE.CylinderGeometry(0.045, 0.06, 2.4, 10), at: [0, 0.1, 0], weight: 0.8 },
  {
    geometry: new THREE.CircleGeometry(0.3, 14),
    at: [0.34, 0.55, 0],
    rot: [-0.4, 0, 0.9],
    scale: [1.5, 0.9, 1],
    weight: 1.2,
  },
  {
    geometry: new THREE.CircleGeometry(0.26, 14),
    at: [-0.3, -0.15, 0],
    rot: [0.35, 0, -1],
    scale: [1.5, 0.9, 1],
    weight: 1.2,
  },
];

/* The bitcoin coin leans hard on the density weight: the disc samples at a
 * fraction of its area's share (0.55) while the B emblem floats just off the
 * face at weight 4, so the mark reads dense and bright against a sparse coin. */
export const BITCOIN_PARTS: ShapePart[] = [
  // the coin, face to the camera
  {
    geometry: new THREE.CylinderGeometry(1.5, 1.5, 0.24, 48),
    rot: [Math.PI / 2, 0, 0],
    weight: 0.55,
  },
  // the B: stem, two bowls, four serifs
  { geometry: new THREE.BoxGeometry(0.16, 1.5, 0.09), at: [-0.3, 0, 0.16], weight: 4 },
  { geometry: new THREE.TorusGeometry(0.33, 0.08, 10, 24), at: [-0.02, 0.36, 0.16], weight: 4 },
  { geometry: new THREE.TorusGeometry(0.38, 0.08, 10, 24), at: [0.02, -0.38, 0.16], weight: 4 },
  { geometry: new THREE.BoxGeometry(0.12, 0.3, 0.09), at: [-0.16, 0.95, 0.16], weight: 4 },
  { geometry: new THREE.BoxGeometry(0.12, 0.3, 0.09), at: [0.14, 0.95, 0.16], weight: 4 },
  { geometry: new THREE.BoxGeometry(0.12, 0.3, 0.09), at: [-0.16, -0.95, 0.16], weight: 4 },
  { geometry: new THREE.BoxGeometry(0.12, 0.3, 0.09), at: [0.14, -0.95, 0.16], weight: 4 },
];
