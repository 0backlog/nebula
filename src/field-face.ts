import { dial10, fieldHash01, type FieldFormation, type FieldLiveCtx } from "./field.js";
import {
  buildDeformWeights,
  DEFAULT_FACE,
  FACE_FEATURE_PEAK,
  FACE_FEATURE_PLAIN,
  FACE_FEATURE_WEIGHT,
  FACE_LANDMARK_COUNT,
  MOUTH_TRAVEL,
  ROUND_TRAVEL,
  SPREAD_TRAVEL,
  toFaceGeometry,
  type FaceAsset,
  type FaceDeform,
  type FaceGeometry,
} from "./field-face-asset.js";
import { faceGesture, sampleFaceDrive } from "./field-face-drive.js";
import { baryAt, jitterAt, pickFromCdf } from "./sampling.js";

/* field-face: the talking face as a FieldFormation. The cloud is sampled over
 * the landmark mesh (area-weighted triangle pick + barycentric spread, per index
 * and deterministic, the same philosophy as field-shapes.ts), with each
 * triangle's area scaled by the feature weight of its landmarks so the eyes,
 * nose and lips get the points a flat area sample would spend on cheeks. Each
 * point KEEPS its triangle and barycentric coordinates. So the cloud re-derives
 * its position from the CURRENT landmarks every frame instead of being a baked
 * pose: move the jaw landmarks and the dots on the jaw follow.
 *
 * The talk itself is an xy displacement field layered on the incoming position,
 * which is what keeps the resting breath, the beat tremble, the morph lerp,
 * cursor physics, the trail and the gather all working. It is scaled by the
 * per-point morph progress (ctx.e), so a face morphing in does not snap its
 * mouth open and a face morphing out closes as it leaves.
 *
 * Depth is real (the nose sits about half a face-space unit forward of the
 * cheeks), so DsField.orient turns a head that reads as facing the pointer. The
 * talk itself moves x and y only: the landmark deltas are an xy field, so the
 * jaw drops and spreads but does not swing back, which under a moderate yaw
 * range reads correctly. (`live` can move depth as well, in the triple form;
 * the face has no use for it.)
 *
 * No three: this is arithmetic over typed arrays. */

const OUT: [number, number] = [0, 0];

/* Per-frame landmark deltas, in face space. Module level and sized to the fixed
 * landmark count: only one face formation is live in the point loop at a time,
 * and the active instance rewrites them from its own deform weights. */
const LM_DX = new Float32Array(FACE_LANDMARK_COUNT);
const LM_DY = new Float32Array(FACE_LANDMARK_COUNT);

/* Talk state, module level for the same reason: a host's knob wrapper
 * recreates the formation object on every slider change, and the mouth must not
 * reset mid-sentence because someone nudged the dot size. */
const talk = {
  lastT: -1,
  open: 0,
  spread: 0,
  round: 0,
  idle: 0,
  blinkT: 0,
  blinkNext: 0,
  blinkIdx: 0,
  blinkAmt: 0,
};

// idle life between utterances: a slow, shallow breath of the jaw, and a blink
// on a deterministic clock (no Math.random anywhere in this path)
const IDLE_HZ = 0.9;
const IDLE_OPEN = 0.025;
const IDLE_BELOW = 0.02; // the drive level under which idle engages
const BLINK_MIN = 2.4;
const BLINK_SPAN = 4.1; // so intervals run 2.4 to 6.5 seconds
const BLINK_CLOSE = 0.12;
const BLINK_OPEN = 0.18;
const BLINK_TRAVEL = 0.92; // how far the upper lid falls toward the lower one
// how far the mouth-near dots brighten at a full open
const GLOW_BOOST = 0.8;
// gaussian width of that brightening, in face-space units
const GLOW_SIGMA = 0.22;
/* Rest brightness at the two ends of the feature weighting. The density boost
 * puts the points on the eyes, nose and lips; this is what makes them read
 * before a word is spoken, by holding the flat plates back rather than only
 * lifting the features. Alpha, not size: the engine's glow attribute multiplies
 * brightness only. */
const REST_DIM = 0.45;
const REST_LIT = 1.35;

/* The gesture blink dial multiplies the RATE: the scheduled wait is drawn in
 * nominal seconds and elapses in rate-scaled time, so a dial change retunes
 * the wait already in progress; the close/open ramps advance in real time and
 * keep their tuned durations at any rate. */
function advanceBlink(d: number, rate: number) {
  if (rate <= 0.01) {
    // parked: no scheduling, and a lid caught mid-blink eases open at the
    // normal ramp speed rather than freezing where the rate change found it
    talk.blinkT = 0;
    talk.blinkNext = 0;
    talk.blinkAmt = Math.max(0, talk.blinkAmt - d / BLINK_OPEN);
    return;
  }
  if (talk.blinkNext <= 0)
    talk.blinkNext = BLINK_MIN + fieldHash01(talk.blinkIdx * 31 + 7) * BLINK_SPAN;
  talk.blinkT += talk.blinkT < talk.blinkNext ? d * rate : d;
  const e = talk.blinkT - talk.blinkNext;
  if (e < 0) {
    // a lid still easing open from a park keeps its ramp instead of snapping open
    talk.blinkAmt = Math.max(0, talk.blinkAmt - d / BLINK_OPEN);
  } else if (e < BLINK_CLOSE) {
    talk.blinkAmt = e / BLINK_CLOSE;
  } else if (e < BLINK_CLOSE + BLINK_OPEN) {
    talk.blinkAmt = 1 - (e - BLINK_CLOSE) / BLINK_OPEN;
  } else {
    talk.blinkIdx++;
    talk.blinkT = 0;
    talk.blinkNext = BLINK_MIN + fieldHash01(talk.blinkIdx * 31 + 7) * BLINK_SPAN;
    talk.blinkAmt = 0;
  }
}

/* Rewrite the landmark deltas for this frame. 468 landmarks and a handful of
 * operations each, next to a loop that runs up to 15000 times. */
function advanceFace(t: number, geo: FaceGeometry, df: FaceDeform) {
  // r3f resets the clock on tab background and resume, so t can jump backwards:
  // floor at 0 and cap at one long frame.
  const d = talk.lastT < 0 ? 0 : Math.max(0, Math.min(0.05, t - talk.lastT));
  talk.lastT = t;

  const drive = sampleFaceDrive(d);
  talk.spread = drive.spread;
  talk.round = drive.round;
  talk.idle =
    drive.open < IDLE_BELOW ? IDLE_OPEN * (0.5 + 0.5 * Math.sin(t * Math.PI * 2 * IDLE_HZ)) : 0;
  talk.open = drive.open + talk.idle;

  // the host's per-channel gesture dials (jaw drop, lip spread, blink rate),
  // already mapped by setFaceGesture into the units the travels below are
  // multiplied by, so nothing here has to know the 0..10 scale exists
  const g = faceGesture();
  advanceBlink(d, g.blink);

  LM_DX.fill(0);
  LM_DY.fill(0);

  const p = geo.pos;
  const drop = talk.open * MOUTH_TRAVEL * g.jaw;
  const wide = talk.spread * SPREAD_TRAVEL * g.lips;
  const purse = talk.round * ROUND_TRAVEL * g.lips;
  for (let k = 0; k < FACE_LANDMARK_COUNT; k++) {
    const ow = df.openW[k];
    if (ow !== 0) LM_DY[k] -= drop * ow;
    const sw = df.spreadW[k];
    if (sw !== 0) {
      const x = p[k * 3];
      // stretch pulls the corners out (i, e); the pucker pulls them in (o, u)
      LM_DX[k] += (x < 0 ? -1 : 1) * (wide - purse) * sw;
      // a wide mouth is a thinner mouth: the lips close toward their own line;
      // a rounded mouth is a taller one: they push away from it
      LM_DY[k] -=
        (p[k * 3 + 1] - df.yMouth) *
        (0.25 * talk.spread - 0.5 * talk.round) *
        g.lips *
        sw;
    }
  }

  if (talk.blinkAmt > 0.001) {
    const pairs = df.blinkPairs;
    const amt = talk.blinkAmt * BLINK_TRAVEL;
    for (let i = 0; i < pairs.length; i += 2) {
      const up = pairs[i] * 3;
      const lo = pairs[i + 1] * 3;
      LM_DX[pairs[i]] += (p[lo] - p[up]) * amt;
      LM_DY[pairs[i]] += (p[lo + 1] - p[up + 1]) * amt;
    }
  }
}

type FaceTables = {
  a0: Uint16Array;
  a1: Uint16Array;
  a2: Uint16Array;
  w0: Float32Array;
  w1: Float32Array;
  /** gaussian on the rest distance from the mouth center, for the glow hook */
  mouthNear: Float32Array;
  /** 0 on a flat plate, 1 on a feature, for the rest brightness */
  feature: Float32Array;
  geo: FaceGeometry;
  df: FaceDeform;
};

/* One-entry cache on (asset, count, seed). A host's knob wrapper rebuilds the
 * formation object on every slider change, which invalidates the engine's target
 * cache and re-runs build; without this, scrubbing a slider would re-derive up
 * to 15000 anchors per frame. */
let cache: { asset: FaceAsset; count: number; seed: number; tables: FaceTables } | null = null;

function tablesFor(asset: FaceAsset, count: number, seed: number): FaceTables {
  if (cache && cache.asset === asset && cache.count === count && cache.seed === seed) {
    return cache.tables;
  }
  const geo = toFaceGeometry(asset);
  const df = buildDeformWeights(geo);
  const p = geo.pos;
  const tris = geo.tris;
  const triCount = tris.length / 3;

  // area-weighted cumulative distribution over the mesh's triangles, each
  // triangle's area scaled by the mean feature weight of its three landmarks: a
  // flat cheek plate is worth a fraction of a lip triangle of the same size
  const cum = new Float64Array(triCount);
  let total = 0;
  for (let t = 0; t < triCount; t++) {
    const i0 = tris[t * 3];
    const i1 = tris[t * 3 + 1];
    const i2 = tris[t * 3 + 2];
    const a = i0 * 3;
    const b = i1 * 3;
    const c = i2 * 3;
    const wt = (FACE_FEATURE_WEIGHT[i0] + FACE_FEATURE_WEIGHT[i1] + FACE_FEATURE_WEIGHT[i2]) / 3;
    const abx = p[b] - p[a];
    const aby = p[b + 1] - p[a + 1];
    const abz = p[b + 2] - p[a + 2];
    const acx = p[c] - p[a];
    const acy = p[c + 1] - p[a + 1];
    const acz = p[c + 2] - p[a + 2];
    const cx = aby * acz - abz * acy;
    const cy = abz * acx - abx * acz;
    const cz = abx * acy - aby * acx;
    total += Math.sqrt(cx * cx + cy * cy + cz * cz) * 0.5 * wt;
    cum[t] = total;
  }

  const a0 = new Uint16Array(count);
  const a1 = new Uint16Array(count);
  const a2 = new Uint16Array(count);
  const w0 = new Float32Array(count);
  const w1 = new Float32Array(count);
  const mouthNear = new Float32Array(count);
  const feature = new Float32Array(count);
  const inv2s2 = 1 / (2 * GLOW_SIGMA * GLOW_SIGMA);
  const featSpan = FACE_FEATURE_PEAK - FACE_FEATURE_PLAIN;
  for (let i = 0; i < count; i++) {
    // prefix-stable: the anchor for index i depends on i and the seed only, so
    // raising the count knob keeps every existing dot on its existing triangle
    const lo = pickFromCdf(cum, fieldHash01(i * 7 + seed) * total);
    const [u, v] = baryAt(i, seed);
    a0[i] = tris[lo * 3];
    a1[i] = tris[lo * 3 + 1];
    a2[i] = tris[lo * 3 + 2];
    w0[i] = u;
    w1[i] = v;

    const k0 = a0[i] * 3;
    const k1 = a1[i] * 3;
    const k2 = a2[i] * 3;
    const w2 = 1 - u - v;
    const rx = p[k0] * w2 + p[k1] * u + p[k2] * v;
    const ry = p[k0 + 1] * w2 + p[k1 + 1] * u + p[k2 + 1] * v;
    const rz = p[k0 + 2] * w2 + p[k1 + 2] * u + p[k2 + 2] * v;
    const dx = rx - df.mouth.x;
    const dy = ry - df.mouth.y;
    const dz = rz - df.mouth.z;
    mouthNear[i] = Math.exp(-(dx * dx + dy * dy + dz * dz) * inv2s2);

    const fw =
      FACE_FEATURE_WEIGHT[a0[i]] * w2 +
      FACE_FEATURE_WEIGHT[a1[i]] * u +
      FACE_FEATURE_WEIGHT[a2[i]] * v;
    const fn = (fw - FACE_FEATURE_PLAIN) / featSpan;
    feature[i] = fn < 0 ? 0 : fn > 1 ? 1 : fn;
  }

  const tables: FaceTables = { a0, a1, a2, w0, w1, mouthNear, feature, geo, df };
  cache = { asset, count, seed, tables };
  return tables;
}

/* the diffusion dial's internal spread, in world units, the face's own scale of
 * it: 0 is a perfectly crisp surface, 0.008 the tuned nominal, and 0.05 the
 * softest the head takes. It tops out far below the shapes' 0.12 because a face
 * carries its silhouette in small features (the lid line, the lip line) rather
 * than in one outline: what still reads as dust on a torus knot closes the eyes
 * of a head at the same radius. */
const DIFFUSION_MIN = 0;
const DIFFUSION_NOMINAL = 0.008;
const DIFFUSION_MAX = 0.05;

export type FaceFormationOpts = {
  count: number;
  /** the landmark asset; omitted, the committed neutral face */
  asset?: FaceAsset;
  /** world radius the head is scaled to */
  radius?: number;
  /** vertical center offset in world units */
  y?: number;
  /** edge diffusion dial, 0..10 (default 5): how far sampled points scatter off
   *  the landmark surface, which is what makes the head read crisp or soft. 0
   *  is a perfectly crisp surface, 5 the tuned 0.008 world units, 10 the
   *  softest (0.05) the features survive. A BUILD input, not a live one: it is
   *  baked into the point positions, so changing it means a new factory call
   *  and a rebuild, which the engine takes into the live cloud in place (no
   *  remount, no reshuffle: every point keeps its own anchor triangle and only
   *  its offset off the surface scales). The talk itself is unaffected: the
   *  mouth is a per-frame delta on top of whatever the build left. */
  diffusion?: number;
  seed?: number;
} & Omit<FieldFormation, "build">;

/* A talking head as a point cloud. Drive it with attachFaceAudio (an audio
 * element) or setFaceDrive (a voice agent pushing amplitude); with neither, it
 * breathes and blinks. */
export function faceFormation({
  count,
  asset,
  radius = 2.2,
  y = 0.05,
  diffusion = 5,
  seed = 1,
  ...personality
}: FaceFormationOpts): FieldFormation {
  const face = asset ?? DEFAULT_FACE;
  // resolved once, at factory time: it is geometry, not a per-frame amount
  const spread = dial10(diffusion, DIFFUSION_MIN, DIFFUSION_NOMINAL, DIFFUSION_MAX);
  let tables: FaceTables | null = null;

  const live = (x: number, ly: number, c: FieldLiveCtx): readonly [number, number] => {
    const tb = tables;
    if (!tb) {
      OUT[0] = x;
      OUT[1] = ly;
      return OUT;
    }
    // advance the shared talk state once per frame, on the first point: live
    // runs before glow for the same index, so glow sees this frame's values
    if (c.i === 0) advanceFace(c.t, tb.geo, tb.df);
    const i = c.i;
    const k0 = tb.a0[i];
    const k1 = tb.a1[i];
    const k2 = tb.a2[i];
    const u = tb.w0[i];
    const v = tb.w1[i];
    const w2 = 1 - u - v;
    const dx = (LM_DX[k0] * w2 + LM_DX[k1] * u + LM_DX[k2] * v) * radius;
    const dy = (LM_DY[k0] * w2 + LM_DY[k1] * u + LM_DY[k2] * v) * radius;
    // a DELTA on the incoming position, eased by the morph progress
    OUT[0] = x + dx * c.e;
    OUT[1] = ly + dy * c.e;
    return OUT;
  };

  /* Brightness carries the features at rest and the open mouth on top. Both are
   * eased by the morph progress, so a face on its way in or out is a plain cloud
   * at the same brightness as every other formation. */
  const glow = (i: number, c: FieldLiveCtx): number => {
    const tb = tables;
    if (!tb) return 1;
    let g = REST_DIM + (REST_LIT - REST_DIM) * tb.feature[i];
    // VOICE only: the idle breath must not cross the gate, or the mouth dots
    // pulse at rest instead of holding constant brightness
    const voiced = talk.open - talk.idle;
    if (voiced >= 0.01) g += GLOW_BOOST * voiced * tb.mouthNear[i];
    return 1 + (g - 1) * c.e;
  };

  return {
    ...personality,
    live,
    glow,
    // a face is intrinsic: the build ignores the viewport
    build: (): Float32Array => {
      const tb = tablesFor(face, count, seed);
      tables = tb;
      const p = tb.geo.pos;
      const out = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) {
        const k0 = tb.a0[i] * 3;
        const k1 = tb.a1[i] * 3;
        const k2 = tb.a2[i] * 3;
        const u = tb.w0[i];
        const v = tb.w1[i];
        const w2 = 1 - u - v;
        out[i * 3] = (p[k0] * w2 + p[k1] * u + p[k2] * v) * radius + jitterAt(i, seed, 1, spread);
        out[i * 3 + 1] =
          (p[k0 + 1] * w2 + p[k1 + 1] * u + p[k2 + 1] * v) * radius + y + jitterAt(i, seed, 2, spread);
        out[i * 3 + 2] =
          (p[k0 + 2] * w2 + p[k1 + 2] * u + p[k2 + 2] * v) * radius + jitterAt(i, seed, 3, spread);
      }
      return out;
    },
  };
}
