import {
  fieldHash01,
  type FieldFormation,
  type FieldLiveCtx,
  type FieldViewport,
} from "./field.js";
import { FIELD_CAMERA } from "./field-camera.js";
import { diffusionSpread, jitterAt } from "./sampling.js";

/* formations: the generic formations, the ones that are a shape rather than a
 * page. Nine factories, each parameterized by point count and (where it makes
 * sense) the live viewport. Geometry defaults reproduce the extracted shape;
 * personality (opacity, size, chaos) is the caller's. Nothing here knows about
 * any particular layout.
 *
 * ONE RULE FOR THE VOLUMES: every formation here that reads with depth (the
 * cloud, the horizon, the helix, the flower, the veins) takes `radius` and
 * `diffusion`, the two build inputs field-shapes gives a sampled geometry, with
 * the same meaning and the same world units. `radius` is the object's reach from
 * its own center; `diffusion` is the 0..10 dial for how far a point sits off the
 * surface it belongs to, 5 the tuned 0.02 world units. So a host sizes and
 * softens a helix exactly as it sizes and softens a torus knot. The four FLAT
 * fields (curtain, lattice, stream, hourglass) take neither: they are scattered
 * across the live viewport or laid out in their own plane, which is what sizes
 * them, and a flat scatter has no surface to sit off.
 *
 * SCATTERED AND LAID OUT ARE NOT THE SAME THING, and the difference is which
 * frame a build reads. A scatter (the curtain, the stream, the lobed cloud)
 * spans the whole canvas and is MEANT to run off its edges, so it reads
 * vp.ww/vp.wh and spans a little past them on purpose. A laid-out field (the
 * lattice, the hourglass) is a drawing with edges of its own, so it reads
 * vp.sw/vp.sh, the canvas less whatever the host has declared spoken for, and
 * fits itself into that: see planeFit below for why centering could not do
 * that job on its own. Nothing here is a special case for one page; both are
 * the same question answered for two kinds of field.
 *
 * Every builder scatters with fieldHash01, so a formation is stable across
 * renders and across a count change: point i lands in the same place whether
 * the count is 2000 or 15000 (prefix-stable), which is what lets a count knob
 * glide instead of reshuffling the whole cloud. A build is handed over whole:
 * when the engine draws fewer points than it holds (the mobile budget) it
 * strides through the build rather than cutting the tail, so even the two
 * grids here, which are laid out rather than scattered, thin instead of crop.
 *
 * A factory instance is bound to ONE DsField: build captures viewport extents
 * in the factory closure, so two canvases sharing an instance would fight over
 * them. Create one instance per canvas.
 *
 * THE ADDITIVE TRAVEL RULE, which every flowing formation here obeys (the
 * curtain's drift, the sand's fall, the river's current, the helix's climb, the
 * network's flow): the hook works out where the point is NOW and where it was
 * BUILT, and adds the difference onto the incoming position, scaled by the
 * point's arrival (`ctx.e`). Two things follow, and both matter.
 *
 * ARRIVAL SCALES THE DISPLACEMENT, NOT THE TRAVEL. The travel has to keep its
 * whole period, because the position it feeds is periodic in it and the wrap
 * only cancels the travel when the two match. Cut the travel to a fraction of a
 * period and the wrap stops landing where the point already is, so every point
 * that recycles mid-morph teleports, once a period, for as long as the
 * formation is morphing in. Scaled at the end instead, the displacement is
 * continuous across the wrap and still exactly 0 at arrival 0.
 *
 * And the travel is BOUNDED to one period (a modulo) before the arrival scales
 * it, so a clock reset (a backgrounded tab coming back) can only shift the
 * phase, never race the flow through many periods at once.
 *
 * No three: this is arithmetic over typed arrays. */

/** `live` callbacks run per point per frame and the engine reads the returned
 *  tuple synchronously, so each factory writes into one reused cell rather than
 *  allocating an array per point per frame. */
type Out = [number, number];
/** the same cell for a hook whose motion has depth: the engine takes z from the
 *  third slot instead of leaving it at the built value. */
type OutZ = [number, number, number];

const TAU = Math.PI * 2;

/** the caller's `radius` when it is a real one, else null, which means "keep
 * the size you were built at". Absent is the common case (every parametric
 * volume here ships at a size that already works); zero and non-finite are
 * guarded because a host binding a cleared number input must not collapse the
 * cloud to a dot, the same defence dial10 runs on a NaN dial. */
function askedRadius(radius: number | undefined): number | null {
  return radius != null && Number.isFinite(radius) && radius > 0 ? radius : null;
}

/** the factor that takes an object built at `reach` to the radius a caller
 * asked for, and exactly 1 when they asked for nothing. Every intrinsic volume
 * here scales through this one number, everything it is made of by the same
 * factor, so the shape is the same shape at any size. */
function radiusScale(radius: number | undefined, reach: number): number {
  return (askedRadius(radius) ?? reach) / reach;
}

/** an option that is a FRACTION of something else (a waist against a rim),
 * clamped to 0..1 with a fallback for the non-finite case: a host binding a
 * cleared number input must not collapse a shape to a line or turn its profile
 * inside out. */
function fraction01(v: number, fallback: number): number {
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : fallback;
}

/** wrap a travel param back into [-1, 1], a range of 2, which is what makes the
 * endless flows endless: a point that runs off one end comes back in at the
 * other, on the very shape it left. */
function wrapUnit(v: number): number {
  return ((((v + 1) % 2) + 2) % 2) - 1;
}

/** per-point drift speeds over min..max, on one hash stream. Every field here
 * that flows gives each point its own steady speed, which is what makes the
 * motion read as a current rather than as a march. */
function speedTable(count: number, min: number, max: number, seed: number): Float32Array {
  const a = new Float32Array(count);
  const span = max - min;
  for (let i = 0; i < count; i++) a[i] = min + fieldHash01(i * 37 + seed) * span;
  return a;
}

/** the grid a laid-out formation walks: the columns it was asked for, and the
 * rows that follow from the count. Ceil on the rows, so a partial last row
 * stays inside the stated extent. Both are floored at 2 because the layout
 * divides by cols - 1 and rows - 1: a host binding a cleared or single-column
 * input would otherwise write NaN into every position, and NaN in the buffer
 * never washes out, since the engine reads the live positions back as the start
 * of the next morph. */
function gridDims(count: number, cols: number): { cols: number; rows: number } {
  const c = Number.isFinite(cols) && cols >= 2 ? cols : 2;
  return { cols: c, rows: Math.max(2, Math.ceil(count / c)) };
}

/* THE FIT RULE FOR A LAID-OUT PLANE: how a `w` by `h` plane standing at depth
 * `z` sits inside the space a person can actually see, which is the safe area
 * the engine hands every build (the frame itself when the host declares no
 * inset). `k` scales the plane, `cx`/`cy` place its middle in the group's own
 * frame.
 *
 * A scattered field bleeds off the frame on purpose and wants none of this. A
 * laid-out one has EDGES, and an edge that stops underneath a floating card
 * reads as a cropped drawing rather than as a field running past the frame.
 *
 * BOTH HALVES ARE HERE BECAUSE OF DEPTH. The engine centers the cloud by moving
 * the whole group, and converts the host's px at the z = 0 plane; a plane
 * standing further back covers proportionally more world for the same screen,
 * so it is a spread of (camera.z - z) / camera.z wider than the safe area
 * reads, and it receives that same fraction LESS of the move than it needed.
 * At the lattice's shipped -1.8 the spread is 1.22: ignore it in the size and a
 * fifth of the space goes unused, ignore it in the middle and the group's move
 * lands 18% short, which is the last column back under the card the move was
 * there to clear. `cx` adds only what the group's move is missing, so the two
 * compose instead of doubling: at z = 0 the spread is 1, `cx` is 0, and a plane
 * in the origin's own plane is left exactly where the engine put it.
 *
 * `k` never goes above 1, so the stated geometry is the size the formation
 * reads at wherever there is room for it, never a shrink a host did not ask for
 * on a frame that fits. A degenerate safe area, or a plane at or behind the
 * camera, resolves to the plane as stated, for the reason every other guard in
 * this file exists: a host binding a cleared number input must not collapse the
 * cloud to a dot. */
/** the safe area a build lays out into, and the ONE place its fields are read.
 *  The engine always writes all four, but `build` is public and its viewport is
 *  a plain object: a host driving a formation itself, or one written against the
 *  four-field viewport this type used to be, hands over a frame with no safe
 *  area on it. Reading `vp.sw` raw there is `undefined`, which is a NaN through
 *  the first multiply and a NaN in every position after it, and this engine
 *  reads the live positions back as the start of the next morph, so one such
 *  build poisons the cloud for the session. Absent, the safe area IS the frame,
 *  which is exactly what it resolves to when a host declares no inset. */
function safeArea(vp: FieldViewport): { w: number; h: number; x: number; y: number } {
  const ok = (v: number, fallback: number) =>
    Number.isFinite(v) && v > 0 ? v : fallback;
  return {
    w: ok(vp.sw, vp.ww),
    h: ok(vp.sh, vp.wh),
    x: Number.isFinite(vp.sx) ? vp.sx : 0,
    y: Number.isFinite(vp.sy) ? vp.sy : 0,
  };
}

function planeFit(
  vp: FieldViewport,
  w: number,
  h: number,
  z: number
): { k: number; cx: number; cy: number } {
  const spread = (FIELD_CAMERA.z - z) / FIELD_CAMERA.z;
  if (!(spread > 0) || !Number.isFinite(spread)) return { k: 1, cx: 0, cy: 0 };
  const safe = safeArea(vp);
  const fitW = w > 0 ? (safe.w * spread) / w : 1;
  const fitH = h > 0 ? (safe.h * spread) / h : 1;
  const fit = Math.min(fitW, fitH, 1);
  return {
    k: Number.isFinite(fit) && fit > 0 ? fit : 1,
    cx: safe.x * (spread - 1),
    cy: safe.y * (spread - 1),
  };
}

export type CurtainOpts = {
  count: number;
  /** "none" is a still scatter; "down" drifts it like rain, "right" like dust
   *  on a breeze. Both wrap around the viewport, so the curtain never empties. */
  flow?: "none" | "down" | "right";
  /** per-point drift speed range, world units per second */
  speedMin?: number;
  speedMax?: number;
  /** horizontal spread as a fraction of the viewport's world width */
  spanX?: number;
  /** vertical spread as a fraction of the viewport's world height */
  spanY?: number;
  /** z spread, world units */
  depth?: number;
  seed?: number;
} & Omit<FieldFormation, "build">;

/* A full-frame scatter that tracks the viewport, optionally drifting. The
 * per-point speed and phase tables are allocated INSIDE the factory at exactly
 * `count` entries, because the engine indexes them with the point index and a
 * formation's per-point tables must be sized to its own build, never to the
 * field's capacity. One instance serves one DsField: build writes the wrap
 * extents into the closure, so two canvases sharing it would fight over them. */
export function curtainFormation({
  count,
  flow = "none",
  speedMin = 0.18,
  speedMax = 0.48,
  spanX = 1.02,
  spanY = 1.08,
  depth = 1.4,
  seed = 1,
  ...personality
}: CurtainOpts): FieldFormation {
  const speed = speedTable(count, speedMin, speedMax, seed);
  const phase = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    // the phase spread only has to exceed one wrap period; the modulo below
    // folds it back into the live span whatever the viewport turns out to be
    phase[i] = fieldHash01(i * 41 + seed) * 14;
  }

  // the drift half-extents, captured at build time so the live hook wraps
  // against the viewport the points were actually scattered into
  const half = { x: 6, y: 4 };
  const out: Out = [0, 0];

  // the two drifts, on the additive travel rule at the top of this file: the
  // band wrap is what makes a recycling point invisible, and it only stays
  // invisible while the travel keeps its whole period
  const down = (x: number, y: number, c: FieldLiveCtx): readonly [number, number] => {
    const s = half.y * 2;
    let ny = y - ((c.t * speed[c.i] + phase[c.i]) % s);
    if (ny < -half.y) ny += s;
    out[0] = x;
    out[1] = y + (ny - y) * c.e;
    return out;
  };

  const right = (x: number, y: number, c: FieldLiveCtx): readonly [number, number] => {
    const s = half.x * 2;
    let nx = x + ((c.t * speed[c.i] + phase[c.i]) % s);
    if (nx > half.x) nx -= s;
    out[0] = x + (nx - x) * c.e;
    out[1] = y;
    return out;
  };

  return {
    ...personality,
    live: flow === "down" ? down : flow === "right" ? right : personality.live,
    build: (vp: FieldViewport): Float32Array => {
      half.x = vp.ww * 0.52;
      half.y = vp.wh * 0.55;
      const a = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) {
        a[i * 3] = (fieldHash01(i * 11 + seed + 5) - 0.5) * vp.ww * spanX;
        a[i * 3 + 1] = (fieldHash01(i * 13 + seed + 7) - 0.5) * vp.wh * spanY;
        a[i * 3 + 2] = (fieldHash01(i * 17 + seed + 9) - 0.5) * depth;
      }
      return a;
    },
  };
}

export type LatticeOpts = {
  count: number;
  /** points per row; the row count follows from count / cols */
  cols?: number;
  /** the plane's world width and height where there is room for them, and its
   *  proportions where there is not: the build fits the plane into the space
   *  the frame and the host's safe area leave, and never scales it up */
  width?: number;
  height?: number;
  /** the plane's depth, world units (negative sits behind the origin) */
  z?: number;
} & Omit<FieldFormation, "build">;

/* A flat, regular grid facing the camera, laid out in a plane of its own rather
 * than scattered across the frame. `width` and `height` are the plane it wants,
 * and the build FITS that plane into the space a person can see (the fit rule
 * at the top of this file): a grid has edges, and a column that ends up under
 * a floating card reads as a cropped object rather than as a field bleeding off
 * the frame. It is the one formation here big enough as it ships to need that,
 * and centering alone could never give it: an object wider than the gap between
 * two cards does not fit at any position.
 *
 * With room, nothing happens: the fit stops at 1, so the stated plane is the
 * plane, and a wide frame is exactly what it always was. Where there is no
 * room it bites whether or not a host declared an inset, because a frame with
 * nothing over it IS its own safe area, and this is the honest answer either
 * way: 11.2 wide at z = -1.8 covers the frame out to about 1.35 to 1, and on
 * anything narrower the grid now stops at the sides instead of running past
 * them with its outer columns cropped away. The height never bites on its own,
 * since the world height at z = 0 is the camera's and does not move with the
 * frame.
 *
 * It takes no seed: a lattice is the one formation here with nothing to
 * randomize. */
export function latticeFormation({
  count,
  cols = 100,
  width = 11.2,
  height = 7.2,
  z = -1.8,
  ...personality
}: LatticeOpts): FieldFormation {
  return {
    ...personality,
    build: (vp: FieldViewport): Float32Array => {
      const a = new Float32Array(count * 3);
      const { cols: colCount, rows: rowCount } = gridDims(count, cols);
      // one factor on both axes, so the grid keeps its own proportions and its
      // cells stay square rather than being stretched into the frame's shape
      const { k, cx, cy } = planeFit(vp, width, height, z);
      const w = width * k;
      const h = height * k;
      for (let i = 0; i < count; i++) {
        const c = i % colCount;
        const r = Math.floor(i / colCount);
        a[i * 3] = cx + (c / (colCount - 1)) * w - w / 2;
        a[i * 3 + 1] = cy + (r / (rowCount - 1)) * h - h / 2;
        a[i * 3 + 2] = z;
      }
      return a;
    },
  };
}

export type HourglassOpts = {
  count: number;
  /** world height of the whole timer, the top rim down to the bottom one */
  height?: number;
  /** world width at the rims, where the two bells are widest */
  width?: number;
  /** the waist as a fraction of the rims' width, 0..1: how hard the pinch in
   *  the middle is. 0.1 is a real throat the sand has to crowd through, 1 is a
   *  straight column and no hourglass at all. */
  waist?: number;
  /** per-point fall speed range, in bell-to-bell travels a second: 0.2 takes a
   *  grain ten seconds to cross the whole timer. Both at 0 stills the fall. */
  speedMin?: number;
  speedMax?: number;
  /** z spread, world units: a whisper of depth so the field is not a decal */
  depth?: number;
  seed?: number;
} & Omit<FieldFormation, "build" | "live">;

// the timer's waist, named because it is spelled twice: once as the option's
// default, once as the value a non-finite input falls back to
const HOURGLASS_WAIST = 0.1;

/* THE SAND TIMER, as a point field. Two bells, one above the other, joined by a
 * narrow waist, and the sand FALLS: every point walks down its own timer and a
 * point that runs out of the bottom comes back in at the top, so the fall never
 * ends and the timer never empties.
 *
 * The waist is the whole point, so the width a point may sit at is a function of
 * how far up the timer it is (`waist` of the rim width at the middle, the full
 * rim out at either end, on a mild power curve so the bells read convex rather
 * than as two cones), and the fall is a walk down THAT function: a point's
 * across-the-bell fraction is fixed, its height is what moves, so the sand
 * crowds into the throat on the way through and spreads again below. The fall
 * runs on the additive travel rule at the top of this file, so the timer fills
 * continuously as the formation morphs in instead of jumping to full flow.
 *
 * The wrap is a return, not a tear: a point keeps its across fraction, and the
 * profile is symmetric top to bottom, so it reappears exactly above where it
 * started, at the rim it left through, on the field it never left.
 *
 * FLAT, so no `radius` and no `diffusion`, like the curtain, the lattice and the
 * stream. It is laid out in its own plane the way the lattice is, so it fits
 * that plane into the safe area on the same rule (see planeFit above), for the
 * same reason: a timer with a rim under a floating card is a broken drawing,
 * not a field bleeding off the frame. At the 3.6 by 5.2 it ships, that fit is
 * 1 on any frame with room, so the rule costs it nothing until a host crowds
 * it. The fitted geometry is written into the closure by the BUILD, because the
 * fall reads the same bells the build laid out; the per-point tables live there
 * too, at exactly `count` entries. One instance serves one DsField. */
export function hourglassFormation({
  count,
  height = 5.2,
  width = 3.6,
  waist = HOURGLASS_WAIST,
  speedMin = 0.2,
  speedMax = 0.5,
  depth = 0.3,
  seed = 1,
  ...personality
}: HourglassOpts): FieldFormation {
  const BELL_POW = 0.75; // < 1, so the bells bulge out instead of coning in
  const pinch = fraction01(waist, HOURGLASS_WAIST);
  // the timer's own measurements, at the size the last build fitted it to: half
  // the height, half the rim width, and the throat's half-width. They are
  // closure state rather than constants because the build resolves the fit and
  // the fall has to walk the very bells the build laid out. Seeded with the
  // asked-for geometry, so a formation read before its first build (nothing in
  // the engine does, but a host writing a test might) is the timer it declared.
  const glass = { halfH: height / 2, bell: width / 2, neck: (width / 2) * pinch };

  // per-point tables (stable per i), sized to this factory's count: where
  // across its bell a grain sits (-1..1 of the local half-width), how far up
  // the timer it was built, and how fast it falls
  const across = new Float32Array(count);
  const v0 = new Float32Array(count);
  const speed = speedTable(count, speedMin, speedMax, seed);
  for (let i = 0; i < count; i++) {
    across[i] = fieldHash01(i * 11 + seed + 5) * 2 - 1;
    // uniform up the timer: every row holds the same number of grains, so the
    // throat reads as a bright thread and the bells as the airy volume around
    // it, which is what sand in glass actually looks like. Uniform is also
    // STILL: the fall transports the distribution into itself, so the timer
    // holds its look forever instead of sloshing.
    v0[i] = fieldHash01(i * 13 + seed + 7) * 2 - 1;
  }
  // the built position, cached: the fall subtracts where a grain was BUILT from
  // where it is now every point of every frame, and the built half never moves
  // between builds. Float64, so the cache holds the very numbers posAt wrote
  // and the hook's output is bit-identical to the recomputation it replaces.
  // Refilled by every build (the fit moves the bells), seeded here with the
  // declared geometry so a hook read before any build still answers with it.
  const baseX = new Float64Array(count);
  const baseY = new Float64Array(count);

  /** the timer's half-width at height v (-1 the bottom rim, 1 the top) */
  const halfAt = (v: number) =>
    glass.neck + (glass.bell - glass.neck) * Math.pow(Math.abs(v), BELL_POW);

  const now = [0, 0];
  const out: Out = [0, 0];

  /** where grain i sits at height v, into the given cell */
  const posAt = (i: number, v: number, cell: number[]) => {
    cell[0] = across[i] * halfAt(v);
    cell[1] = v * glass.halfH;
  };

  /** the built positions into the base cache; also seeds the pre-build answer */
  const fillBase = () => {
    for (let i = 0; i < count; i++) {
      posAt(i, v0[i], now);
      baseX[i] = now[0];
      baseY[i] = now[1];
    }
  };
  fillBase();

  const fall = (x: number, y: number, c: FieldLiveCtx): readonly [number, number] => {
    // the additive travel rule at the top of this file, over a period of 2
    const dv = (c.t * speed[c.i]) % 2;
    posAt(c.i, wrapUnit(v0[c.i] - dv), now);
    out[0] = x + (now[0] - baseX[c.i]) * c.e;
    out[1] = y + (now[1] - baseY[c.i]) * c.e;
    return out;
  };

  return {
    ...personality,
    live: fall,
    build: (vp: FieldViewport): Float32Array => {
      // the timer stands in the z = 0 plane (`depth` is a whisper either side of
      // it), which is the plane the engine measures the safe area at, so it
      // takes the fit at face value and no correction on the middle at all
      const { k } = planeFit(vp, width, height, 0);
      glass.halfH = (height * k) / 2;
      glass.bell = (width * k) / 2;
      glass.neck = glass.bell * pinch;
      fillBase();
      const a = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) {
        a[i * 3] = baseX[i];
        a[i * 3 + 1] = baseY[i];
        a[i * 3 + 2] = (fieldHash01(i * 23 + seed + 9) - 0.5) * depth;
      }
      return a;
    },
  };
}

export type CloudOpts = {
  count: number;
  /** world radius of the sphere the points fill, the same convention every 3D
   *  formation takes. It is the sphere BEFORE the `lobes` remap: with lobes on,
   *  the frame has the last word on the final extent and the radius scales it
   *  from there. */
  radius?: number;
  /** z is squashed by this, so the cloud reads as a slab rather than a ball */
  depthScale?: number;
  /** center depth, world units */
  z?: number;
  /** edge diffusion dial, 0..10 (default 5): the same dial, in the same world
   *  units, that a sampled shape takes. 0 is a crisp scatter (every point
   *  exactly where the sphere put it), 5 the tuned 0.02, 10 the softest 0.12.
   *  A volume gives it less to do than a shell does, and that is worth knowing
   *  rather than being surprised by: the inside of a cloud is already a random
   *  scatter, so what the dial visibly softens is the BOUNDARY, the sphere's
   *  rim and, under `lobes`, the two lobe edges. */
  diffusion?: number;
  /** split the sphere into two side lobes on a wide frame (the headphones
   *  look: one lobe flanking each side of the copy) and spread it into a soft
   *  full-frame atmosphere on a square or portrait one, where the lobes would
   *  fall off the narrow frame. The two looks BLEND across the aspects between
   *  square and 4:3 rather than switching at square, so a resize through the
   *  boundary stays continuous. Default false keeps the plain centered cloud. */
  lobes?: boolean;
  seed?: number;
} & Omit<FieldFormation, "build">;

/* The frame aspects the lobed cloud blends BETWEEN: a square frame is all
 * atmosphere, 4:3 and wider is fully split. The two looks blend across this
 * band rather than swapping at square because the engine writes a rebuilt
 * formation straight into the buffer once a morph has settled (it resets the
 * morph phase on a formation or count change only, never on a viewport
 * rebuild), so a mapping that stepped at the boundary would teleport every
 * point on a resize through it. */
const LOBES_FROM = 1;
const LOBES_FULL = 1.34;

/* A volumetric scatter: uniform density inside a sphere. The cube root on the
 * radius is what makes it uniform by VOLUME (sampling the radius linearly
 * crowds every point toward the center), and the acos on the polar angle is
 * what keeps the poles from bunching. With `lobes` the same sphere is remapped
 * per frame shape: stretched to fill a square or portrait frame, pushed apart
 * into two side lobes by 4:3, and blended in between. z is untouched by the
 * remap, so the slab depth reads the same in every mode and a lobes toggle
 * morphs in the xy plane only. */
export function cloudFormation({
  count,
  radius = 3.6,
  depthScale = 0.5,
  z = -1.2,
  diffusion = 5,
  lobes = false,
  seed = 1,
  ...personality
}: CloudOpts): FieldFormation {
  // the dial resolves ONCE, at factory time: it is geometry, not a per-frame
  // amount, and it stays in world units at any radius, exactly as it does on a
  // sampled shape
  const spread = diffusionSpread(diffusion);
  return {
    ...personality,
    build: (vp: FieldViewport): Float32Array => {
      const a = new Float32Array(count * 3);
      // how far the frame has opened from square toward holding the full
      // lobes, smoothstepped so there is no kink at either end of the band
      const s = Math.min(
        1,
        Math.max(0, (vp.ww / vp.wh - LOBES_FROM) / (LOBES_FULL - LOBES_FROM))
      );
      const split = s * s * (3 - 2 * s);
      for (let i = 0; i < count; i++) {
        const r = radius * Math.cbrt(fieldHash01(i * 3 + seed + 1));
        const th = fieldHash01(i * 5 + seed + 2) * TAU;
        const ph = Math.acos(2 * fieldHash01(i * 7 + seed + 4) - 1);
        let x = r * Math.sin(ph) * Math.cos(th);
        let y = r * Math.sin(ph) * Math.sin(th);
        if (lobes) {
          // atmosphere: the sphere spread to fill the visible frame
          // (center-dense, edges sparse)
          const ax = (x / radius) * (vp.ww / 2) * 1.05;
          const ay = (y / radius) * (vp.wh / 2) * 0.95;
          // lobes: each half pushed outward past the copy and compressed, so
          // the sphere splits into two soft ear shapes
          const lx = Math.sign(x || 1) * (radius * 0.93 + Math.abs(x) * 0.55);
          const ly = y * 0.62;
          x = ax + (lx - ax) * split;
          y = ay + (ly - ay) * split;
        }
        a[i * 3] = x + jitterAt(i, seed, 1, spread);
        a[i * 3 + 1] = y + jitterAt(i, seed, 2, spread);
        a[i * 3 + 2] = r * Math.cos(ph) * depthScale + z + jitterAt(i, seed, 3, spread);
      }
      return a;
    },
  };
}

export type HorizonOpts = {
  count: number;
  /** points per row across the width; rows recede into depth */
  cols?: number;
  /** world width of the plane */
  width?: number;
  /** how far the plane recedes, world units */
  depth?: number;
  /** the near edge's z; the plane runs from here to z + depth */
  z?: number;
  /** the ground plane's height, world units */
  y?: number;
  /** the plane's reach from its own center, world units: the far corner of the
   *  footprint, 8.5 at the default 15 by 8. Absent (the default) it keeps the
   *  size `width` and `depth` state; passed, the footprint scales to match,
   *  keeping its proportions, its ground height and its near edge. */
  radius?: number;
  /** edge diffusion dial, 0..10 (default 5): how far each point sits off the
   *  cell it was laid in, which is what stops a perfectly even lattice reading
   *  as a screen door. The same dial and the same world units as a sampled
   *  shape (5 the tuned 0.02), with one concession to what the plane is: y
   *  takes two thirds of it, so the ground stays flat enough to read as
   *  ground. */
  diffusion?: number;
  seed?: number;
} & Omit<FieldFormation, "build">;

/* A ground plane receding from the camera, and the formation that documents
 * the `floor` field: the factory sets floor by default, which is what makes
 * the cursor physics act WITHIN the plane (points slide along the ground
 * instead of lifting toward the camera). Pass floor: undefined to opt out. */
export function horizonFormation({
  count,
  cols = 120,
  width = 15,
  depth = 8,
  z = -5.2,
  y = -1.65,
  radius,
  diffusion = 5,
  seed = 1,
  ...personality
}: HorizonOpts): FieldFormation {
  // the plane scales to the reach a caller asked for. The near edge stays at
  // `z` and the ground at `y`, so a wider plane recedes further instead of
  // sliding toward the camera.
  const scale = radiusScale(radius, Math.hypot(width / 2, depth / 2));
  const w = width * scale;
  const d = depth * scale;
  // the dial resolves ONCE, at factory time, and stays in world units at any
  // size, exactly as it does on a sampled shape
  const spread = diffusionSpread(diffusion);
  return {
    floor: { y },
    ...personality,
    build: (): Float32Array => {
      const a = new Float32Array(count * 3);
      const { cols: colCount, rows: rowCount } = gridDims(count, cols);
      for (let i = 0; i < count; i++) {
        const c = i % colCount;
        const r = Math.floor(i / colCount);
        a[i * 3] = (c / (colCount - 1)) * w - w / 2 + jitterAt(i, seed, 1, spread);
        a[i * 3 + 1] = y + jitterAt(i, seed, 2, spread) * (2 / 3);
        a[i * 3 + 2] = (r / (rowCount - 1)) * d + z + jitterAt(i, seed, 3, spread);
      }
      return a;
    },
  };
}

export type StreamOpts = {
  count: number;
  /** the pinch, as a fraction of the mouths' height, 0..1: how far the river
   *  narrows at the center. 0.34 is the tuned funnel, 1 is the flat full-frame
   *  band the stream used to be. */
  waist?: number;
  seed?: number;
} & Omit<FieldFormation, "build" | "live">;

// the river's pinch, spelled twice for the same reason the timer's waist is
const STREAM_WAIST = 0.34;

/* A horizontal river, and a FUNNEL: wide at both mouths, pinched through the
 * middle, so the current narrows into the center of the frame and opens again
 * on the way out. The profile is smoothed (a smoothstep on the distance from
 * the center, flat at both mouths and flat through the neck) rather than a
 * straight taper, so there is no crease where the banks turn.
 *
 * The current runs LEFT TO RIGHT, wrapping at the right mouth, and every point
 * keeps its own steady speed, which is what makes the field read as a current
 * rather than a march. The funnel survives the drift because a point's
 * ACROSS-the-river fraction is what is fixed, not its y: the flow hook re-reads
 * the profile at the x the point has flowed to, so the river holds its shape
 * while the water moves through it. That displacement rides the additive travel
 * rule at the top of this file, so the funnel fades in with the morph instead of
 * snapping.
 *
 * The wrap is seamless in y as well as in shape: the profile is symmetric, so a
 * point leaving the right mouth re-enters the left one at the very same height.
 *
 * Like the curtain, the per-point tables live in the factory closure at exactly
 * `count` entries, and the wrap half-width is captured at build time so the flow
 * wraps against the viewport the points were actually scattered into. One
 * instance serves one DsField, for the same closure reason as the curtain. */
export function streamFormation({
  count,
  waist = STREAM_WAIST,
  seed = 1,
  ...personality
}: StreamOpts): FieldFormation {
  const neck = fraction01(waist, STREAM_WAIST);
  // every point keeps its own steady speed, in world units a second
  const speed = speedTable(count, 0.18, 0.48, seed);
  const phase = new Float32Array(count);
  // where across the river a point rides, -1 the near bank and 1 the far one.
  // Fixed per point: the banks move under it, it does not move between them.
  const across = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    phase[i] = fieldHash01(i * 41 + seed);
    across[i] = fieldHash01(i * 11 + seed) * 2 - 1;
  }

  const river = { hx: 6, hy: 4 };
  const out: Out = [0, 0];

  /** the river's half-height at x: the full mouth out at either end, `neck` of
   *  it at the center, smoothstepped between so both ends and the throat are
   *  flat and nothing creases. */
  const halfAt = (x: number) => {
    const u = Math.min(1, Math.abs(x) / river.hx);
    const s = u * u * (3 - 2 * u);
    return river.hy * (neck + (1 - neck) * s);
  };

  const flow = (x: number, y: number, c: FieldLiveCtx): readonly [number, number] => {
    // the additive travel rule, and the profile is read at the x the point is
    // ACTUALLY at, eased and all, so the banks hold their shape at every stage
    // of the morph and not only once it has arrived
    const range = river.hx * 2;
    let nx = x + ((c.t * speed[c.i] + phase[c.i] * range) % range);
    if (nx > river.hx) nx -= range;
    const fx = x + (nx - x) * c.e;
    out[0] = fx;
    out[1] = y + (halfAt(fx) - halfAt(x)) * across[c.i];
    return out;
  };

  return {
    ...personality,
    live: flow,
    build: (vp: FieldViewport): Float32Array => {
      river.hx = (vp.ww / 2) * 1.02; // span the full width, bleeding to the edges
      river.hy = (vp.wh / 2) * 1.06;
      const a = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) {
        const x = (fieldHash01(i * 7 + seed) * 2 - 1) * river.hx;
        a[i * 3] = x;
        a[i * 3 + 1] = across[i] * halfAt(x);
        a[i * 3 + 2] = (fieldHash01(i * 23 + seed) - 0.5) * 0.25;
      }
      return a;
    },
  };
}

export type DnaOpts = {
  count: number;
  /** the helix's reach from its own center, world units: the far end of a
   *  strand, ~2.17 as it ships, which is the shape convention a geometry is
   *  sampled at. Absent (the default) it keeps that size, so nothing moves for
   *  a caller who passes nothing; passed, the whole object scales, axis, strand
   *  radius and rungs alike, and the scroll scales with it. The reach is exact:
   *  no point of the build sits outside it. */
  radius?: number;
  /** edge diffusion dial, 0..10 (default 5): how far each point sits off the
   *  strand or rung it belongs to, which is what makes the ladder read crisp or
   *  soft. The same dial, and the same world units, that a sampled shape takes:
   *  0 a clean wire, 5 the tuned 0.02, 10 the softest 0.12. Absolute, so it
   *  does not scale with `radius`: a big helix at diffusion 5 is a big helix
   *  with the same dust on it, exactly as a big torus knot is. */
  diffusion?: number;
  seed?: number;
} & Omit<FieldFormation, "build" | "live">;

/* A centered double helix with real cylindrical depth: two opposite-phase
 * strands wind around a vertical-ish axis at EQUAL x and z radii and evenly
 * spaced base-pair rungs bridge them straight through the axis. EVERY point
 * belongs to a strand or a rung: what softens the ladder's edge is `diffusion`,
 * the dial a sampled shape takes, and nothing else. No halo rides outside the
 * ladder, which is what makes the stated reach exact.
 *
 * The object is intrinsic (build ignores the viewport) and sized to the shape
 * convention (~2.17 world units of reach from the center, and `radius` moves
 * that number like it moves a geometry's), with a slight resting tilt baked
 * into the build, tilt (x) then azimuth (y) like ShapePart.rot, so the depth
 * reads before a host orient ever moves. Being a true volume, it reads
 * correctly under the same front-faces-+z orient math as the shapes.
 *
 * The ladder climbs live: each point's param advances along the helix axis, on
 * the additive travel rule at the top of this file, so the helix grows in
 * continuously as the formation morphs. A wrapped point lands back exactly on
 * the helix at the other end, so the wrap reads as recycling dust, never a
 * tear. The travel moves all THREE axes (the hook returns the triple form,
 * adding onto ctx.z): a helix on a tilted axis carries most of its shape in z,
 * so an xy-only scroll would leave every point at the depth of where it started
 * and the cylinder would flatten and shear within seconds. */
export function dnaFormation({
  count,
  radius,
  diffusion = 5,
  seed = 1,
  ...personality
}: DnaOpts): FieldFormation {
  const AXIS = 2.1; // axis half-length at the shipped size
  const R0 = 0.55; // strand radius at it, the same in x and z (the cylindrical depth)
  // the helix scales from its built reach (the far end of a strand, ~2.17) to
  // the radius a caller asked for
  const scale = radiusScale(radius, Math.hypot(AXIS, R0));
  const HALF_LEN = AXIS * scale; // axis half-length
  const R = R0 * scale; // strand radius
  const TURNS = 2.5; // twists over the full length
  const RUNGS = 12; // evenly spaced base-pair rungs up the ladder
  const RUNG_FRAC = 0.32; // share of points that form rungs (a prominent ladder)
  const SCROLL = 0.05; // travel speed along the axis, param units per second
  // the diffusion dial resolves ONCE, at factory time: it is geometry, not a
  // per-frame amount, and it is world units at any radius
  const spread = diffusionSpread(diffusion);

  // the resting tilt, baked into the build: enough lean that the near strand
  // passes visibly in front of the far one at rest
  const TILT_X = 0.35;
  const TILT_Y = 0.5;
  const cx = Math.cos(TILT_X);
  const sx = Math.sin(TILT_X);
  const cy = Math.cos(TILT_Y);
  const sy = Math.sin(TILT_Y);

  // per-point tables (stable per i), written by build and read by the scroll;
  // sized to this factory's count, never to the field's capacity
  const h0 = new Float32Array(count); // base position param along the axis, in [-1, 1]
  const amp = new Float32Array(count); // strand: phase (0 | pi). rung: cross fraction 0..1
  const kind = new Uint8Array(count); // 0 = strand point, 1 = rung point
  // the built position, cached: the scroll subtracts where a point was BUILT
  // from where it is now every point of every frame, and the built half never
  // moves after build (posAt costs trig, and half its calls were spent on it).
  // Float64, so the cache holds the very numbers posAt wrote and the hook's
  // output is bit-identical to the recomputation it replaces.
  const baseX = new Float64Array(count);
  const baseY = new Float64Array(count);
  const baseZ = new Float64Array(count);

  // position param (h in [-1, 1]) to helix angle
  const angleAt = (h: number) => ((h + 1) / 2) * TAU * TURNS;

  // the tilted xyz of point i at param h (no jitter), into the given cell:
  // helix in local space (axis = y), then Rx(TILT_X), then Ry(TILT_Y)
  const posAt = (i: number, h: number, cell: number[]) => {
    const ang = angleAt(h);
    let lx: number;
    let lz: number;
    if (kind[i] === 1) {
      // rung: a straight bar from strand A's rim through the axis to B's
      const cross = 1 - 2 * amp[i];
      lx = Math.cos(ang) * R * cross;
      lz = Math.sin(ang) * R * cross;
    } else {
      lx = Math.cos(ang + amp[i]) * R;
      lz = Math.sin(ang + amp[i]) * R;
    }
    const ly = h * HALF_LEN;
    const ty = ly * cx - lz * sx; // after the x tilt
    const tz = ly * sx + lz * cx;
    cell[0] = lx * cy + tz * sy; // after the y azimuth
    cell[1] = ty;
    cell[2] = -lx * sy + tz * cy;
  };

  const now = [0, 0, 0];
  const base = [0, 0, 0];
  const out: OutZ = [0, 0, 0];

  const scroll = (
    x: number,
    y: number,
    c: FieldLiveCtx
  ): readonly [number, number, number] => {
    // the additive travel rule at the top of this file, over a period of 2
    const dh = (c.t * SCROLL) % 2;
    posAt(c.i, wrapUnit(h0[c.i] + dh), now);
    out[0] = x + (now[0] - baseX[c.i]) * c.e;
    out[1] = y + (now[1] - baseY[c.i]) * c.e;
    out[2] = c.z + (now[2] - baseZ[c.i]) * c.e;
    return out;
  };

  return {
    ...personality,
    live: scroll,
    build: (): Float32Array => {
      const a = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) {
        const i3 = i * 3;

        if (fieldHash01(i * 31 + seed + 4) < RUNG_FRAC) {
          // base-pair rung: snap to one of RUNGS evenly spaced params
          // (periodic, so the ladder scrolls seamlessly), lerp across from
          // strand A to strand B
          const k = Math.floor(fieldHash01(i * 37 + seed + 6) * RUNGS) % RUNGS;
          h0[i] = (k / RUNGS) * 2 - 1;
          amp[i] = fieldHash01(i * 41 + seed + 8);
          kind[i] = 1;
        } else {
          // strand point: spread along the full axis, split evenly between the
          // two opposite-phase strands
          h0[i] = fieldHash01(i * 59 + seed + 7) * 2 - 1;
          amp[i] = fieldHash01(i * 61 + seed + 9) < 0.5 ? 0 : Math.PI;
          kind[i] = 0;
        }

        // on the strand or the rung it belongs to, plus the diffusion dial's
        // scatter and nothing else
        posAt(i, h0[i], base);
        baseX[i] = base[0];
        baseY[i] = base[1];
        baseZ[i] = base[2];
        a[i3] = base[0] + jitterAt(i, seed, 1, spread);
        a[i3 + 1] = base[1] + jitterAt(i, seed, 2, spread);
        a[i3 + 2] = base[2] + jitterAt(i, seed, 3, spread);
      }
      return a;
    },
  };
}

export type FlowerOpts = {
  count: number;
  /** the flower's reach from its own center, world units: a petal tip, which
   *  is where the dome has fallen furthest back. Absent (the default) the
   *  flower sizes itself from the frame's SHORTER side, so it holds its
   *  proportions from desktop to phone and nothing changes for a caller who
   *  passes nothing; passed, it is built to that reach at any frame shape, the
   *  same convention a sampled geometry is scaled to. The reach is exact: no
   *  point of the build sits outside it. */
  radius?: number;
  /** edge diffusion dial, 0..10 (default 5): how far each point sits off the
   *  petal surface it belongs to, which is what feathers the lobe edges instead
   *  of leaving them as an outline. The same dial, and the same world units,
   *  that a sampled shape takes: 0 a crisp wheel, 5 the tuned 0.02, 10 the
   *  softest 0.12. Absolute, so it does not scale with `radius`. It is also the
   *  ONLY thing that softens the edge: every point belongs to a petal. */
  diffusion?: number;
  seed?: number;
} & Omit<FieldFormation, "build">;

/* A wheel of seven teardrop petals on a shallow convex dome: z crests toward
 * the middle and falls away at the rim. EVERY point sits on a petal, and what
 * feathers the lobe edges is `diffusion` and nothing else, which is what makes
 * the stated reach exact.
 *
 * Centered at the origin and sized from the frame's shorter side unless a
 * `radius` says otherwise. The petal is drawn from the point's own hash, not
 * interleaved by index, so the mobile trim's stride cannot take a whole lobe
 * with it, and every per-point draw is in units of the scale, so a flower at
 * one radius is a pure radial morph of the same flower at another: the same
 * point sits on the same petal at the same along/across params, and growing one
 * into the other is a clean grow.
 *
 * The dome is the source's dish MIRRORED on purpose: the source built the
 * flower concave (center receding, rim toward the camera) and compensated
 * inside its own per-point tilt hook. Under a plain group-rotation orient a
 * concave face reads inverted, the hollow-mask illusion: the parallax of a
 * receding center is exactly that of a bulging center turning the OTHER way.
 * Bulging toward +z puts the flower's front where every shape's front is, so
 * the same orient math reads correctly at any size. */
export function flowerFormation({
  count,
  radius,
  diffusion = 5,
  seed = 1,
  ...personality
}: FlowerOpts): FieldFormation {
  const PETALS = 7; // lobes around the center
  // the flower's proportions, all as multiples of the scale `s` the build
  // resolves: where a petal begins, how long it runs, how wide its belly is,
  // and how far the dome crests toward the camera and falls back at the rim
  const ROOT = 0.52;
  const PETAL_LEN = 1.22;
  const HALF_W = 0.48;
  const Z_CREST = 0.72;
  const DOME_DROP = 1.3;
  // the built reach as a multiple of `s`: a petal tip, out at ROOT + PETAL_LEN
  // and back at the dome's rim. `radius` is that reach in world units, so the
  // flower answers the same size convention a sampled geometry does.
  const REACH = Math.hypot(ROOT + PETAL_LEN, DOME_DROP - Z_CREST);
  const asked = askedRadius(radius);
  // the diffusion dial resolves ONCE, at factory time, and stays in world units
  // at any size, exactly as it does on a sampled shape
  const spread = diffusionSpread(diffusion);

  /* teardrop width profile along a petal: 0 at the root, widest near the
   * middle, tapering back to a point at the tip. t in 0..1. */
  const petalWidth = (t: number) => Math.sin(Math.PI * Math.pow(t, 0.7));

  return {
    ...personality,
    build: (vp: FieldViewport): Float32Array => {
      // an asked-for radius is the size, whatever the frame: a world-unit size
      // a host declared is not one the library second-guesses. With none, the
      // whole flower scales with the shorter side of the space a person can
      // SEE rather than of the whole canvas, so it fills a comfortable share of
      // it at any aspect ratio and a card floating over the frame takes its
      // share of the drawing rather than covering a petal.
      const safe = safeArea(vp);
      const s = asked != null ? asked / REACH : Math.min(safe.w, safe.h) * 0.2;

      // the petal geometry at this scale
      const root = ROOT * s; // where a petal begins, out from center
      const petalLen = PETAL_LEN * s; // root to tip
      const halfW = HALF_W * s; // half-width of the lobe belly
      const maxR = root + petalLen; // outer rim radius (for the dome)

      // convex dome: z crests toward the center (toward the camera at +z) and
      // falls away at the rim. The exact negation of the source's concave dish;
      // see the factory comment for why.
      const zCrest = Z_CREST * s;
      const domeDrop = DOME_DROP * s;

      const a = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) {
        const i3 = i * 3;

        // petal assignment + per-point along/across params from hashes (stable
        // per i, identical at every scale). The petal is DRAWN rather than
        // taken as i % PETALS: the engine's mobile trim decimates the build
        // with a stride, and a stride that is a multiple of seven would leave
        // an interleaved flower with a single petal.
        const petal = Math.floor(fieldHash01(i * 8.3 + seed + 7) * PETALS) % PETALS;
        const pa = (petal / PETALS) * TAU; // this petal's outward heading

        // along the petal (root to tip), biased so points fill the belly
        // rather than piling at the very tip; across the petal in -1..1
        const tAlong = Math.pow(fieldHash01(i * 3.1 + seed + 1), 0.85);
        const sAcross = fieldHash01(i * 5.7 + seed + 2) * 2 - 1;

        const r = root + tAlong * petalLen; // radius out along the axis
        const across = sAcross * petalWidth(tAlong) * halfW;

        // radial unit (axis) + its perpendicular, to place the lobe in plane
        const ax = Math.cos(pa);
        const ay = Math.sin(pa);

        const lx = r * ax + across * -ay;
        const ly = r * ay + across * ax;

        // dome: distance from center, normalized, squared, a smooth crown that
        // is highest at the middle and eases down to the rim
        const rNorm = Math.min(1, r / maxR);
        const z = zCrest - domeDrop * rNorm * rNorm;

        // and the diffusion dial, off the petal the point landed on: the same
        // scatter, from the same helper, that a sampled shape gets
        a[i3] = lx + jitterAt(i, seed, 1, spread);
        a[i3 + 1] = ly + jitterAt(i, seed, 2, spread);
        a[i3 + 2] = z + jitterAt(i, seed, 3, spread);
      }
      return a;
    },
  };
}

export type VeinsOpts = {
  count: number;
  /** the network's reach from its own center, world units: the far side of the
   *  furthest tip, ~2.21 as it ships, which is the shape convention a geometry
   *  is sampled at. Absent (the default) it keeps that size, so nothing moves
   *  for a caller who passes nothing; passed, the whole tree scales, trunks,
   *  branches and vessel thickness alike, and the flow scales with it. The reach
   *  is MEASURED off the grown tree rather than declared (see the factory), so
   *  nothing but the diffusion dust sits outside it. */
  radius?: number;
  /** edge diffusion dial, 0..10 (default 5): how far each point sits off the
   *  vessel it belongs to, which is what makes the network read crisp or soft.
   *  The same dial, and the same world units, that a sampled shape takes: 0 a
   *  clean set of tubes, 5 the tuned 0.02, 10 the softest 0.12. Absolute, so it
   *  does not scale with `radius`. */
  diffusion?: number;
  seed?: number;
} & Omit<FieldFormation, "build" | "live">;

/* A BRANCHING NETWORK in three dimensions, read like a map of vessels: three
 * trunks leave the center in a fan, each forks into two thinner branches, and
 * each of those forks again into two thinner twigs. Twelve root-to-tip routes
 * in all, and a fork is owned by the NODE rather than by the route, so the four
 * routes that leave through one trunk walk the very same trunk: the network is a
 * tree, not twelve separate wires laid on top of each other. That sharing is
 * also what makes the trunks read as trunks, because every point riding any of
 * those four routes spends its trunk stretch on the same vessel.
 *
 * EVERY point lies on a vessel: a route, a distance along it, and a spot inside
 * the tube around it, whose thickness halves at every fork and tapers from one
 * end of a segment to the other, so the branches thin as they divide. What
 * softens the edge is `diffusion`, the dial a sampled shape takes, and nothing
 * else.
 *
 * The tube's cross frame is CARRIED along a route (each segment projects its
 * parent's frame onto its own direction, the smallest turn that keeps it
 * perpendicular) rather than rebuilt per segment: a rebuilt frame would flip at
 * a fork and every off-axis point would snap sideways as it crossed one.
 *
 * And the network FLOWS. Each point travels down its route from trunk to tip and
 * wraps back to the trunk, so the field reads as something moving through a
 * system rather than as a diagram of one. The travel runs on the additive travel
 * rule at the top of this file, over a period of one whole route, and the points
 * are spread evenly along a route, so the flow transports the network into
 * itself and what moves is the dots, never the shape. The hook returns the
 * TRIPLE form, adding onto ctx.z: a tree that fans in three dimensions carries
 * as much of itself in z as in xy, and an xy-only travel would shear it flat
 * within seconds.
 *
 * The object is intrinsic (build ignores the viewport) and sized to the shape
 * convention, so it reads correctly under the same front-faces-+z orient math as
 * the shapes. */
export function veinsFormation({
  count,
  radius,
  diffusion = 5,
  seed = 1,
  ...personality
}: VeinsOpts): FieldFormation {
  const TRUNKS = 3; // vessels leaving the center
  const SPLIT = 2; // children at every fork
  const LEVELS = 3; // segments from the root to a tip: trunk, branch, twig
  const PATHS = TRUNKS * SPLIT ** (LEVELS - 1); // root-to-tip routes
  const LEN0 = 1; // trunk length at the shipped size
  const LEN_TAPER = 0.75; // and how much shorter each generation runs
  const RAD0 = 0.13; // trunk half-thickness at the shipped size
  const RAD_TAPER = 0.5; // halved at every fork, which is the whole read
  const LEAN = 0.62; // how far a child leans off its parent, radians
  const FLOW = 0.07; // travel along a route, routes a second
  // the diffusion dial resolves ONCE, at factory time: it is geometry, not a
  // per-frame amount, and it is world units at any radius
  const spread = diffusionSpread(diffusion);

  // the route tables: for every route and every level, the segment it walks
  // (A to B), the cross frame its tube offsets ride in, and the tube's
  // half-thickness at each end. Sized to the tree, not to the point count.
  const SEGS = PATHS * LEVELS;
  const segA = new Float32Array(SEGS * 3);
  const segB = new Float32Array(SEGS * 3);
  const segE1 = new Float32Array(SEGS * 3);
  const segE2 = new Float32Array(SEGS * 3);
  const segRA = new Float32Array(SEGS);
  const segRB = new Float32Array(SEGS);

  // where each level starts and ends as a fraction of a route. Every route runs
  // the same lengths, so one table serves all twelve.
  const frac: number[] = [0];
  let total = 0;
  for (let l = 0; l < LEVELS; l++) total += LEN0 * LEN_TAPER ** l;
  let run = 0;
  for (let l = 0; l < LEVELS; l++) {
    run += LEN0 * LEN_TAPER ** l;
    frac.push(run / total);
  }

  // grow the tree. A route is walked from the root outward, and every draw the
  // walk makes keys off the NODE it is standing on, so two routes sharing a
  // prefix compute the identical prefix and share the vessel.
  for (let p = 0; p < PATHS; p++) {
    const k = Math.floor(p / SPLIT ** (LEVELS - 1));
    // the trunk's heading: the three fan evenly over the sphere (even in the
    // y band, golden-angle around it), nudged per trunk so the fan does not
    // read as a mechanism
    const dy0 = 1 - (2 * k + 1) / TRUNKS;
    const rr = Math.sqrt(Math.max(0, 1 - dy0 * dy0));
    const th = k * 2.39996 + fieldHash01(k * 13 + seed + 1) * 0.7;
    let dx = rr * Math.cos(th);
    let dy = dy0;
    let dz = rr * Math.sin(th);
    // the cross frame, seeded off the world axis the trunk leans on least (so
    // the perpendicular is never near-degenerate) and carried from there
    const ax = Math.abs(dx);
    const ay = Math.abs(dy);
    const az = Math.abs(dz);
    let e1x = ax <= ay && ax <= az ? 1 : 0;
    let e1y = ay < ax && ay <= az ? 1 : 0;
    let e1z = e1x === 0 && e1y === 0 ? 1 : 0;
    let e2x = 0;
    let e2y = 0;
    let e2z = 0;
    let px = 0;
    let py = 0;
    let pz = 0;
    let node = k; // the id of the node the next segment leaves from

    for (let lvl = 0; lvl < LEVELS; lvl++) {
      if (lvl > 0) {
        // the fork: this route's child index here, and the twist the NODE
        // itself owns, so every route through the node forks the same way
        const child = Math.floor(p / SPLIT ** (LEVELS - 1 - lvl)) % SPLIT;
        const a = (child / SPLIT + fieldHash01(node * 17 + seed + 3)) * TAU;
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        const cl = Math.cos(LEAN);
        const sl = Math.sin(LEAN);
        // lean off the parent by LEAN, around the azimuth, in the parent's own
        // cross frame (which is a unit basis perpendicular to it, so the result
        // is already unit length)
        const lx = e1x * ca + e2x * sa;
        const ly = e1y * ca + e2y * sa;
        const lz = e1z * ca + e2z * sa;
        dx = dx * cl + lx * sl;
        dy = dy * cl + ly * sl;
        dz = dz * cl + lz * sl;
        node = TRUNKS + node * SPLIT + child; // a fresh id, unique per fork
      }
      const dl = Math.hypot(dx, dy, dz) || 1;
      dx /= dl;
      dy /= dl;
      dz /= dl;
      // re-perpendicularize the carried frame onto this direction: the smallest
      // turn that keeps it a cross frame, so a point's offset barely moves as
      // it crosses the fork
      const dot = e1x * dx + e1y * dy + e1z * dz;
      e1x -= dx * dot;
      e1y -= dy * dot;
      e1z -= dz * dot;
      const el = Math.hypot(e1x, e1y, e1z) || 1;
      e1x /= el;
      e1y /= el;
      e1z /= el;
      e2x = dy * e1z - dz * e1y;
      e2y = dz * e1x - dx * e1z;
      e2z = dx * e1y - dy * e1x;

      const len = LEN0 * LEN_TAPER ** lvl;
      const s = p * LEVELS + lvl;
      const s3 = s * 3;
      segA[s3] = px;
      segA[s3 + 1] = py;
      segA[s3 + 2] = pz;
      px += dx * len;
      py += dy * len;
      pz += dz * len;
      segB[s3] = px;
      segB[s3 + 1] = py;
      segB[s3 + 2] = pz;
      segE1[s3] = e1x;
      segE1[s3 + 1] = e1y;
      segE1[s3 + 2] = e1z;
      segE2[s3] = e2x;
      segE2[s3 + 1] = e2y;
      segE2[s3 + 2] = e2z;
      segRA[s] = RAD0 * RAD_TAPER ** lvl;
      segRB[s] = RAD0 * RAD_TAPER ** (lvl + 1);
    }
  }

  /* the tree's reach, measured rather than declared: at a segment end the tube
   * offset is perpendicular to the segment, so the furthest a point around that
   * end can sit from the center is sqrt(|P|² + r² + 2r|P across the segment|),
   * and a straight segment's own furthest point is always an end. The max over
   * every end is therefore a reach the vessels never pass, ~2.21 as the tree
   * ships. The diffusion dust rides outside it, exactly as it does on a helix or
   * a sampled shape. */
  let reach2 = 0;
  for (let s = 0; s < SEGS; s++) {
    const s3 = s * 3;
    const dx = segB[s3] - segA[s3];
    const dy = segB[s3 + 1] - segA[s3 + 1];
    const dz = segB[s3 + 2] - segA[s3 + 2];
    const dl = Math.hypot(dx, dy, dz) || 1;
    for (let end = 0; end < 2; end++) {
      const q = end === 0 ? segA : segB;
      const r = end === 0 ? segRA[s] : segRB[s];
      const p2 = q[s3] * q[s3] + q[s3 + 1] * q[s3 + 1] + q[s3 + 2] * q[s3 + 2];
      const along = (q[s3] * dx + q[s3 + 1] * dy + q[s3 + 2] * dz) / dl;
      const perp = Math.sqrt(Math.max(0, p2 - along * along));
      reach2 = Math.max(reach2, p2 + r * r + 2 * r * perp);
    }
  }
  // the tree scales from that measured reach to the one a caller asked for
  const scale = radiusScale(radius, Math.sqrt(reach2));
  if (scale !== 1) {
    for (let i = 0; i < SEGS * 3; i++) {
      segA[i] *= scale;
      segB[i] *= scale;
    }
    for (let s = 0; s < SEGS; s++) {
      segRA[s] *= scale;
      segRB[s] *= scale;
    }
  }

  // per-point tables (stable per i), written by build and read by the flow;
  // sized to this factory's count, never to the field's capacity
  const route = new Uint8Array(count); // which root-to-tip route the point rides
  const s0 = new Float32Array(count); // how far along it the point was built, 0..1
  // the point's spot in the tube's cross section, as the two frame amounts
  // already multiplied by its distance from the axis: no trig in the hook
  const oc = new Float32Array(count);
  const os = new Float32Array(count);
  // the built position, cached, for the same reason the helix caches its own:
  // the flow subtracts where a point was BUILT every point of every frame, and
  // the built half never moves after build. Float64, so the hook's output is
  // bit-identical to the recomputation it replaces.
  const baseX = new Float64Array(count);
  const baseY = new Float64Array(count);
  const baseZ = new Float64Array(count);

  // the xyz of point i at route fraction s (no jitter), into the given cell:
  // find the segment the fraction lands in, walk it, step off the axis
  const posAt = (i: number, s: number, cell: number[]) => {
    const p = route[i];
    let lvl = LEVELS - 1;
    for (let l = 0; l < LEVELS - 1; l++) {
      if (s < frac[l + 1]) {
        lvl = l;
        break;
      }
    }
    const u = (s - frac[lvl]) / (frac[lvl + 1] - frac[lvl]);
    const q = p * LEVELS + lvl;
    const q3 = q * 3;
    const rad = segRA[q] + (segRB[q] - segRA[q]) * u;
    const c1 = oc[i] * rad;
    const c2 = os[i] * rad;
    cell[0] = segA[q3] + (segB[q3] - segA[q3]) * u + segE1[q3] * c1 + segE2[q3] * c2;
    cell[1] =
      segA[q3 + 1] + (segB[q3 + 1] - segA[q3 + 1]) * u + segE1[q3 + 1] * c1 + segE2[q3 + 1] * c2;
    cell[2] =
      segA[q3 + 2] + (segB[q3 + 2] - segA[q3 + 2]) * u + segE1[q3 + 2] * c1 + segE2[q3 + 2] * c2;
  };

  const now = [0, 0, 0];
  const base = [0, 0, 0];
  const out: OutZ = [0, 0, 0];

  const travel = (
    x: number,
    y: number,
    c: FieldLiveCtx
  ): readonly [number, number, number] => {
    // the additive travel rule at the top of this file, over a period of 1
    const ds = (c.t * FLOW) % 1;
    let s = s0[c.i] + ds;
    if (s >= 1) s -= 1;
    posAt(c.i, s, now);
    out[0] = x + (now[0] - baseX[c.i]) * c.e;
    out[1] = y + (now[1] - baseY[c.i]) * c.e;
    out[2] = c.z + (now[2] - baseZ[c.i]) * c.e;
    return out;
  };

  return {
    ...personality,
    live: travel,
    build: (): Float32Array => {
      const a = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) {
        const i3 = i * 3;
        // the route, drawn from the point's own hash rather than laid out as
        // i % PATHS. The engine's mobile trim DECIMATES a build with a stride,
        // and a stride sharing a factor with twelve (a half budget strides by
        // two) would drop whole limbs off the network on the small frame where
        // it can least afford them. A hash spreads across every route at any
        // stride, and it costs nothing but an exactly even split, which at these
        // counts is a rounding difference.
        route[i] = Math.min(PATHS - 1, Math.floor(fieldHash01(i * 19 + seed + 6) * PATHS));
        // even along the route, which is what keeps the flow from sloshing, and
        // what loads the trunks: four routes share one, so a trunk carries four
        // times the traffic of a twig, exactly as a vessel does
        s0[i] = fieldHash01(i * 3.1 + seed + 1);
        // and evenly through the tube's cross section: the root is what stops
        // every point piling on the axis
        const ang = fieldHash01(i * 5.7 + seed + 2) * TAU;
        const rf = Math.sqrt(fieldHash01(i * 7.3 + seed + 4));
        oc[i] = Math.cos(ang) * rf;
        os[i] = Math.sin(ang) * rf;

        // on the vessel it belongs to, plus the diffusion dial's scatter and
        // nothing else
        posAt(i, s0[i], base);
        baseX[i] = base[0];
        baseY[i] = base[1];
        baseZ[i] = base[2];
        a[i3] = base[0] + jitterAt(i, seed, 1, spread);
        a[i3 + 1] = base[1] + jitterAt(i, seed, 2, spread);
        a[i3 + 2] = base[2] + jitterAt(i, seed, 3, spread);
      }
      return a;
    },
  };
}
