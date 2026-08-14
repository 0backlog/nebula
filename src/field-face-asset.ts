// The committed neutral face. Its landmarks and triangulation are derived from
// the MediaPipe canonical face model (canonical_face_model.obj), Copyright 2020
// The MediaPipe Authors, Apache License 2.0. JSON carries no comments, so the
// same attribution travels inside the file as `notice`.
import neutralJson from "./field-face-neutral.json";

/* field-face-asset: the data half of the talking face: the asset contract, the
 * landmark region sets, the single validation gate, and the runtime tables the
 * formation reads every frame.
 *
 * Face space: +x to the viewer's right, +y up, +z toward the viewer, centered on
 * the landmark bounding box and scaled so the furthest landmark sits at radius
 * 1. Both the committed neutral face and anything a landmark pipeline produces
 * are normalized this way, so a formation scales by one world radius and assets
 * swap without re-tuning anything.
 *
 * No three, no react: this is plain math and typed arrays, so a voice agent on a
 * real page can pull it in without dragging the engine along. */

export type FaceAsset = {
  /** schema version; bump when a field's meaning changes */
  v: 1;
  /** "Neutral", or the photo file's stem */
  name: string;
  /** provenance, travels with a downloaded asset */
  notice?: string;
  /** 468 xyz triplets, length 1404 */
  points: number[];
  /** 898 triangles as landmark index triples, length 2694 for the MediaPipe
   *  topology; any triangulation over the 468 landmarks validates */
  tris: number[];
};

/** the runtime form: the per-frame path only ever reads typed arrays */
export type FaceGeometry = {
  pos: Float32Array;
  tris: Uint16Array;
};

export const FACE_LANDMARK_COUNT = 468;

/* Semantic landmark sets in MediaPipe's 468-landmark space. The two eye chains
 * are ordered outer to inner and index-paired, which is what makes the blink a
 * straight positional pairing rather than a lookup. */
export const FACE_REGIONS = {
  lipOuterUpper: [61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291],
  lipOuterLower: [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291],
  lipInnerUpper: [78, 191, 80, 81, 82, 13, 312, 311, 310, 415, 308],
  lipInnerLower: [78, 95, 88, 178, 87, 14, 317, 402, 318, 324, 308],
  lipCorners: [61, 291, 78, 308],
  chinMidline: [17, 18, 200, 199, 175, 152],
  jawLine: [172, 136, 150, 149, 176, 148, 152, 377, 400, 378, 379, 365, 397],
  /** the mandible pivot: these stay put, so the jaw swings instead of sliding */
  jawHinge: [58, 132, 93, 323, 361, 288],
  eyeRightUpper: [246, 161, 160, 159, 158, 157, 173],
  eyeRightLower: [7, 163, 144, 145, 153, 154, 155],
  eyeLeftUpper: [466, 388, 387, 386, 385, 384, 398],
  eyeLeftLower: [249, 390, 373, 374, 380, 381, 382],
  eyeRightCorners: [33, 133],
  eyeLeftCorners: [263, 362],
  /* the features that carry the read of a face. They are not deformed, they
   * exist so the sampler can put points where the eye looks first. */
  browRight: [46, 53, 52, 65, 55, 70, 63, 105, 66, 107],
  browLeft: [276, 283, 282, 295, 285, 300, 293, 334, 296, 336],
  nose: [
    168, 6, 197, 195, 5, 4, 1, 19, 94, 2, 98, 97, 326, 327, 129, 358, 115, 220, 45, 275, 440,
    344,
  ],
  faceOval: [
    10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377,
    152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109,
  ],
} as const;

/* Per-landmark sampling density, and the two ends of its range.
 *
 * The mesh's triangles are tiny around the eyes, the nostrils and the lips and
 * huge across the cheeks and the forehead, so a purely area-weighted sample puts
 * almost no points on the features and the cloud reads as an egg: the silhouette
 * is the only thing that survives. This is the same problem composedFormation's
 * per-part `weight` solves for a small dense part against a large flat one.
 * Weights are a property of the landmark topology, not of any one asset, so
 * this is computed once for every face. */
export const FACE_FEATURE_PLAIN = 0.4;
export const FACE_FEATURE_PEAK = 7;

export const FACE_FEATURE_WEIGHT: Float32Array = (() => {
  const w = new Float32Array(FACE_LANDMARK_COUNT).fill(FACE_FEATURE_PLAIN);
  const put = (ks: readonly number[], v: number) => {
    for (const k of ks) if (v > w[k]) w[k] = v;
  };
  const R = FACE_REGIONS;
  // the silhouette reads on its own, it only needs enough to stay crisp
  put(R.faceOval, 1.5);
  put(R.jawLine, 1.5);
  put(R.browRight, 4);
  put(R.browLeft, 4);
  put(R.nose, 4.5);
  for (const chain of [
    R.eyeRightUpper,
    R.eyeRightLower,
    R.eyeLeftUpper,
    R.eyeLeftLower,
    R.eyeRightCorners,
    R.eyeLeftCorners,
    R.lipOuterUpper,
    R.lipOuterLower,
    R.lipInnerUpper,
    R.lipInnerLower,
    R.lipCorners,
  ]) {
    put(chain, FACE_FEATURE_PEAK);
  }
  return w;
})();

/* reference landmarks the deform weights are measured against */
const LM_MOUTH_LINE = 13;
const LM_CHIN = 152;
const LM_MOUTH_INNER_LOWER = 14;
const LM_MOUTH_CORNER = 61;

/** how far a full jaw drop travels, in face-space units (the face is about 1.83
 *  units tall after normalization). The gesture dial multiplies this. */
export const MOUTH_TRAVEL = 0.3;
/** how far a lip corner travels sideways on a full spread, in face-space units */
export const SPREAD_TRAVEL = 0.055;
/** how far the corners pull IN and the lips open vertically on a full round
 *  (the o and u pucker), in face-space units */
export const ROUND_TRAVEL = 0.05;

function isFiniteNumberArray(a: unknown, len: number): a is number[] {
  if (!Array.isArray(a) || a.length !== len) return false;
  for (let i = 0; i < len; i++) {
    const n = a[i];
    if (typeof n !== "number" || !Number.isFinite(n)) return false;
  }
  return true;
}

/* The SINGLE validation gate. The committed json and any host-supplied payload
 * go through the same function, so a corrupt shipped file and a corrupt custom
 * face fail identically. Returns null rather than throwing: every caller falls
 * back to the neutral face. */
export function parseFaceAsset(u: unknown): FaceAsset | null {
  if (!u || typeof u !== "object") return null;
  const o = u as Record<string, unknown>;
  if (o.v !== 1) return null;
  if (typeof o.name !== "string") return null;
  const notice = o.notice;
  if (notice !== undefined && typeof notice !== "string") return null;
  if (!isFiniteNumberArray(o.points, FACE_LANDMARK_COUNT * 3)) return null;
  const tris = o.tris;
  if (!Array.isArray(tris) || tris.length === 0 || tris.length % 3 !== 0) return null;
  for (let i = 0; i < tris.length; i++) {
    const n = tris[i];
    if (typeof n !== "number" || !Number.isInteger(n) || n < 0 || n >= FACE_LANDMARK_COUNT) {
      return null;
    }
  }
  // the deform weights are measured against the face's own x and y extents, so
  // a landmark set that is flat in either one divides by zero there. z carries
  // no divide of its own and is not checked.
  const p = o.points;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < p.length; i += 3) {
    if (p[i] < minX) minX = p[i];
    if (p[i] > maxX) maxX = p[i];
    if (p[i + 1] < minY) minY = p[i + 1];
    if (p[i + 1] > maxY) maxY = p[i + 1];
  }
  if (!(maxX - minX > 1e-6) || !(maxY - minY > 1e-6)) return null;
  // defensive copies: a host mutating its own parsed object later must not
  // corrupt the formation's cached tables
  return {
    v: 1,
    name: o.name,
    notice,
    points: p.slice(),
    tris: tris.slice(),
  };
}

/** Convert once to typed arrays. Called at build time, never per frame. */
export function toFaceGeometry(a: FaceAsset): FaceGeometry {
  return { pos: Float32Array.from(a.points), tris: Uint16Array.from(a.tris) };
}

const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);

export type FaceDeform = {
  /** per-landmark jaw response, mostly 0..1 (the upper lip goes slightly negative) */
  openW: Float32Array;
  /** per-landmark lip-corner response, 0..1, nonzero on the lip chains only */
  spreadW: Float32Array;
  /** blink pairs, flat [upper, lower, upper, lower, ...] */
  blinkPairs: Uint16Array;
  /** rest y of the mouth line, so the spread can thin the lips around it */
  yMouth: number;
  /** rest center of the mouth, for the glow falloff */
  mouth: { x: number; y: number; z: number };
};

/* Precompute the deformation fields from the REST landmarks. Every number here
 * is derived from the asset's own proportions, so a face built from a photo
 * deforms correctly without a second set of constants. */
export function buildDeformWeights(geo: FaceGeometry): FaceDeform {
  const p = geo.pos;
  const n = FACE_LANDMARK_COUNT;
  const yMouth = p[LM_MOUTH_LINE * 3 + 1];
  const yChin = p[LM_CHIN * 3 + 1];
  const span = Math.max(1e-4, yMouth - yChin);
  let xHinge = 1e-4;
  for (const k of FACE_REGIONS.jawHinge) xHinge = Math.max(xHinge, Math.abs(p[k * 3]));
  const xCorner = Math.max(1e-4, Math.abs(p[LM_MOUTH_CORNER * 3]));

  // a smooth base field first, so the cloud never tears at a region seam: the
  // drop fades out toward the mouth line and toward the ears (squared, so the
  // sides by the hinge stay put).
  const openW = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    const below = clamp01((yMouth - p[k * 3 + 1]) / span);
    const lateral = clamp01(1 - Math.abs(p[k * 3]) / xHinge);
    openW[k] = below * lateral * lateral;
  }
  // then the explicit overrides, applied in an order that leaves the corners at
  // a half response (they belong to every lip chain)
  const set = (ks: readonly number[], v: number) => {
    for (const k of ks) openW[k] = v;
  };
  set(FACE_REGIONS.lipOuterUpper, -0.06); // the upper lip lifts a hair
  set(FACE_REGIONS.lipInnerUpper, -0.06);
  set(FACE_REGIONS.lipOuterLower, 1);
  set(FACE_REGIONS.lipInnerLower, 1);
  set(FACE_REGIONS.chinMidline, 1);
  set(FACE_REGIONS.lipCorners, 0.5);

  // the spread field lives on the lip chains only: 1 at the corners, 0 at the
  // midline, so a wide mouth pulls sideways without dragging the cheeks.
  const spreadW = new Float32Array(n);
  for (const chain of [
    FACE_REGIONS.lipOuterUpper,
    FACE_REGIONS.lipOuterLower,
    FACE_REGIONS.lipInnerUpper,
    FACE_REGIONS.lipInnerLower,
  ]) {
    for (const k of chain) spreadW[k] = clamp01(Math.abs(p[k * 3]) / xCorner);
  }

  const pairs: number[] = [];
  const pair = (up: readonly number[], lo: readonly number[]) => {
    const len = Math.min(up.length, lo.length);
    for (let i = 0; i < len; i++) pairs.push(up[i], lo[i]);
  };
  pair(FACE_REGIONS.eyeRightUpper, FACE_REGIONS.eyeRightLower);
  pair(FACE_REGIONS.eyeLeftUpper, FACE_REGIONS.eyeLeftLower);

  const a = LM_MOUTH_LINE * 3;
  const b = LM_MOUTH_INNER_LOWER * 3;
  return {
    openW,
    spreadW,
    blinkPairs: Uint16Array.from(pairs),
    yMouth,
    mouth: {
      x: (p[a] + p[b]) / 2,
      y: (p[a + 1] + p[b + 1]) / 2,
      z: (p[a + 2] + p[b + 2]) / 2,
    },
  };
}

const parsedNeutral = parseFaceAsset(neutralJson);
if (!parsedNeutral) {
  // the committed asset is generated and verified at generation time; a null
  // here means the file in the repo is corrupt, which is a build problem rather
  // than a runtime state worth degrading around.
  throw new Error("field-face: the committed neutral face asset failed validation");
}
export const DEFAULT_FACE: FaceAsset = parsedNeutral;
