"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { FIELD_CAMERA } from "./field-camera.js";
import { dial10, easeRate, EASE_AIM, EASE_STRENGTH, EASE_PRESENCE, fieldHash01, POSE_RATE } from "./field-units.js";
import {
  insetPx,
  measureVp,
  safeShift,
  safeSpan,
  sameVp,
  vpValue,
  type FieldViewport,
  type FieldInset,
} from "./field-viewport.js";
import { SHINE_FRAG, SHINE_VERT, SPOT_MAX } from "./field-shader.js";
import {
  createCursorPresence,
  cursorFalloff,
  cursorPresence,
  cursorPull,
  cursorSwirl,
  CURSOR_PUSH_REPEL,
  CURSOR_RIM2_ATTRACT,
  CURSOR_RIM2_REPEL,
  CURSOR_RIM2_VORTEX,
  CURSOR_GAUSS_REPEL,
  type FieldCursorMode,
} from "./field-cursor.js";
import {
  advanceSpin,
  createSpin,
  DRAG_DAMP_MAX,
  DRAG_DAMP_MIN,
  DRAG_DAMP_NOMINAL,
  DRAG_GAIN_MAX,
  DRAG_GAIN_NOMINAL,
} from "./field-drag.js";
import { useFieldPointer } from "./field-pointer.js";
import {
  createSpotSlots,
  resolveSpotlights,
  SPOT_LGAIN,
  SPOT_LINV,
  SPOT_LX,
  SPOT_LY,
  SPOT_LZ,
  type FieldSpotlight,
  type FieldSpotlights,
} from "./field-spot.js";

/* DsField, the organism. One persistent cloud of points that morphs
 * between named formations: it multiplies, thins, regroups and changes
 * behavior wherever the surface asks it to. This is the engine only;
 * formations are content, injected by the host (the host registers its own).
 *
 * This file is the CORE: the frame loop, the morph, and the contract types.
 * The organs it composes each live in their own file, so a fork can read one
 * concern whole, or cut one out (delete the file, remove its import and the
 * few call sites that name it):
 *   field-units.ts     the dial, the hash, the shared eases
 *   field-viewport.ts  the frame and the safe area
 *   field-shader.ts    the mark (the point shader pair)
 *   field-pointer.ts   the canvas pointer zone and the drag capture
 *   field-cursor.ts    the cursor physics (repel, attract, vortex, presence)
 *   field-drag.ts      drag to spin, and the way home
 *   field-spot.ts      the light pockets
 * What stays here stays because it is the loop itself or is woven through it
 * (the breath, the tremble, the trail's spring, the gather pull, the births
 * and deaths): pulling those out would add indirection to the hottest path
 * and nothing else.
 *
 * Every dial-like number in the public API runs on one 0..10 scale: 0 is the
 * minimum, 10 the maximum, and 5 is ALWAYS the nominal tuned value. dial10
 * (exported below) is the single mapping between a dial and its internal
 * tuned units.
 *
 * THE FORMATION CONTRACT is documented field by field on FieldFormation below,
 * which is where a host's editor reads it. What holds across all of it: every
 * formation must build the SAME LENGTH, and the first one sets the point count.
 * The engine may draw FEWER points than a build holds (the mobile budget), and
 * it decimates with a stride rather than cutting the tail, so a trimmed field
 * thins across the whole shape and a formation laid out in index order (a grid
 * walked row by row) stays a whole grid. Hooks are called with the BUILD index,
 * so a formation's per-point tables always line up.
 *
 * shine (a DsField prop, NOT a formation field): when on, each point's
 * brightness drifts on its own random, gradual clock, a shimmer. It rides the
 * small custom shader `round` (default 10) already selects, so shine 0 is a
 * static field on that same path; the plain PointsMaterial path is reachable
 * only with round={0} and shine, glow, additive and spotlights all off.
 */

/* the public surface that moved into the organ files, re-exported here so
 * everything in this package (and any host that reached into src) keeps one
 * import point: the engine and its contract. */
export { dial10, fieldHash01 } from "./field-units.js";
export type { FieldViewport, FieldInset } from "./field-viewport.js";
export type { FieldCursorMode } from "./field-cursor.js";
export type { FieldSpotlight } from "./field-spot.js";

/** what a `live` or `glow` hook is handed for the point it is called on. ONE
 * object is reused for every point of every frame, so a hook reads it and never
 * keeps it. */
export interface FieldLiveCtx {
  /** the BUILD index of this point, which is what a formation's own per-point
   *  tables are keyed by (a trimmed field's dot 1 may draw build point 4) */
  i: number;
  /** the depth the point arrives at: a hook whose motion has depth reads this
   *  one and returns it moved, in the triple form */
  z: number;
  /** the clock, in seconds */
  t: number;
  /** this point's morph progress, 0 to 1. Scale anything dramatic by it, so a
   *  formation morphing in does not snap into its extreme pose. */
  e: number;
}

export interface FieldFormation {
  /** world-space xyz triplets, one per point. `vp` is the live canvas, so a
   *  formation that tracks the layout rebuilds itself as the frame changes;
   *  an intrinsic shape simply ignores it. A formation that is LAID OUT rather
   *  than scattered reads `vp.sw`/`vp.sh`, the frame less the host's safe area,
   *  so its edges land where a person can see them. */
  build: (vp: FieldViewport) => Float32Array;
  /** resting material opacity (default 0.3; a 0..1 material value, not a
   *  dial). May be a function of the viewport so a formation can dim itself as
   *  the frame narrows (e.g. a figure that recedes on phones so it never
   *  competes with the copy). */
  opacity?: number | ((vp: FieldViewport) => number);
  /** dot size dial, 0..10 (5 = the tuned 0.032 world units, 0 = 0.008,
   *  10 = 0.08; default 5). Like `opacity`, may be a function of the viewport
   *  returning the dial value: finer dots read as further back. */
  size?: number | ((vp: FieldViewport) => number);
  /** breathing dial, 0..10: 0 still, 5 the nominal breath, 10 the wildest
   *  tested (default 5 when absent) */
  chaos?: number;
  /** scale the whole cloud down on narrow viewports, so a drawing stays whole
   *  on a phone. For figures, not for ambient fields: a field is meant to
   *  overflow its frame. */
  fit?: boolean;
  /** the formation lies in the xz ground plane at this y, and the cursor
   *  physics then act WITHIN that plane: points slide along the floor instead
   *  of lifting toward the camera. `vortex` has no floor form and falls back to
   *  the repel push there. */
  floor?: { y: number };
  /** cursor effect radius dial, 0..10 (0 = none, 5 = the tuned reach,
   *  10 = the widest; default 5) */
  cursorReach?: number;
  /** cursor push/pull strength dial, 0..10 (0 = none, 5 = the tuned force,
   *  10 = the hardest; default 5) */
  cursorForce?: number;
  /** a gentle rock around the y axis, the intro mark. It composes with a host
   *  `orient` target rather than replacing it. */
  sway?: boolean;
  /** per-point life after arrival. Return [x, y] to move in the camera-facing
   *  plane, or [x, y, z] when the motion has depth (a helix scrolling along a
   *  tilted axis): `ctx.z` carries the incoming depth, so the triple form is
   *  the same additive move on all three axes. */
  live?: (
    x: number,
    y: number,
    ctx: FieldLiveCtx
  ) => readonly [number, number] | readonly [number, number, number];
  /** per-point brightness multiplier (1 = the formation's base; >1 brightens,
   *  and lifts the dot size a touch). Sampled every frame for every point: a
   *  formation uses it to make a region glow (e.g. lighting the dots nearest one
   *  position along a helix). Needs the shader path: pass `glow` to
   *  DsField so the cloud renders with the per-point material. */
  glow?: (i: number, ctx: FieldLiveCtx) => number;
}

// the transition dial in seconds of morph: dial 5 is the tuned 1.15, dial 0 the
// slowest useful crawl, dial 10 nearly instant (a couple of frames plus the
// per-point stagger). The dial's ends read backwards on purpose: MORE seconds
// is a SLOWER morph, so the dial's minimum is the longest duration.
const MORPH_NOMINAL = 1.15;
const MORPH_SLOW = 6;
const MORPH_FAST = 0.12;
const STAGGER = 0.25;
const BASE_SIZE = 0.032; // the size dial's nominal (dial 5), world units
const SIZE_MIN = 0.008; // the size dial's floor (dial 0)
const SIZE_MAX = 0.08; // the size dial's ceiling (dial 10)
const FIT_WIDTH = 7.6; // figures are laid out for this many world units
// the shuffle dial in world units of DETOUR: the half-width of the per-point
// scatter at the envelope's peak, so a point's typical detour off the straight
// line is the number itself and the widest is 1.7 of it (a corner of the cube
// it is drawn in). Dial 5 (0.9) is a clearly scattered transit on a 12 unit
// wide frame, dial 10 (2.4) a wide swirl that still lands exactly on target,
// and dial 0 is the straight line, at no cost.
const SHUFFLE_NOMINAL = 0.9;
const SHUFFLE_MAX = 2.4;
// the travel a point needs before it takes the full detour, squared (the test
// compares squared distances, so nothing takes a root). Under it the detour
// eases off with the square of the travel, which is what keeps a point whose
// start and end coincide from shivering on a count tick: at zero travel it is
// exactly zero, and a point that barely moves cannot be thrown a world unit.
const SHUFFLE_GATE2 = 1;
// energy → motion response curve. >1 makes the field shrug off the steady/basic
// low end (shallow near 0) while letting strong beats land near full.
const BEAT_GAMMA = 1.8;
// the gather attractor's default falloff scale², large, so the gentle pull
// spans the whole page with no hard edge where it "ends". A payload `r`
// overrides it as r * r * 7.8 (r 1.6 reproduces this default).
const GATHER_SCALE2 = 20;
function easeInOutCubic(t: number) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

// an unregistered formation key (e.g. a page that sets a formation before its
// registration is wired in) must not crash or freeze the canvas: fall back to
// the first registered formation, or undefined when the registry is empty
// (callers then build nothing and hold the default look). Used by the target
// cache AND the frame loop.
//
// The lookup is an OWN-property one, which is the difference between that
// promise and a white screen. A plain read finds Object.prototype's members, so
// a host routing this prop from a url or a cms field turns "constructor" or
// "toString" into a truthy inherited function: the ?? then has nothing to fall
// back from, and the first thing the loop asks of it, build(), throws out of
// the render.
function resolveFormation(
  formations: Record<string, FieldFormation>,
  k: string,
): FieldFormation | undefined {
  const own = Object.prototype.hasOwnProperty.call(formations, k)
    ? formations[k]
    : undefined;
  return own ?? Object.values(formations)[0];
}

// scratch objects for the floor raycast (projecting the cursor onto a
// formation's ground plane)
const NDC = new THREE.Vector2();
const HIT = new THREE.Vector3();
const PLANE = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
// scratch for mapping world space into group-local space: the group's inverse
// rotation, and the mapped vector. ONE mapping, used by everything IN THIS
// FILE that has to answer "where is this, in the cloud's own frame": the
// cursor ray, a floor formation's ground hit, the gather center (the light
// pockets make the same trip in field-spot.ts, on scratch of their own). Each
// writes it and reads its result straight out into scalars, so they never
// overlap (and instances sharing the module scratch cannot race).
const GINV = new THREE.Quaternion();
const W_LOCAL = new THREE.Vector3();
// scratch viewport for resolving per-frame opacity/size functions: rewritten
// each frame so the loop never allocates (write-then-read within one frame,
// so instances sharing it cannot race)
const VP_NOW: FieldViewport = { w: 0, h: 0, ww: 0, wh: 0, sw: 0, sh: 0, sx: 0, sy: 0 };
// scratch ctx handed to a formation's live and glow hooks: one object rewritten
// for every point of every frame (the hook contract says read it, never keep
// it), on the same write-then-read-within-one-frame terms as the rest
const LIVE_CTX: FieldLiveCtx = { i: 0, z: 0, t: 0, e: 1 };

function Cloud({
  formations,
  formation,
  tint,
  additive,
  mode,
  shine,
  glow,
  round,
  intensity,
  energy,
  gather,
  orient,
  spinGain,
  spinDamp,
  spotlights,
  inset,
  morph,
  capacity,
  trail,
  parallax,
  shuffle,
  mobile,
  reducedMotion,
}: {
  formations: Record<string, FieldFormation>;
  formation: string;
  tint: string;
  /** halo amount, INTERNAL 0..1; > 0 also flips to additive blending */
  additive: number;
  mode: FieldCursorMode;
  /** twinkle amount, INTERNAL 0..3: 0 off, 1 the classic, higher flickers harder */
  shine: number;
  /** render with the per-point material so a formation's `glow` hook can light
   *  individual dots. When nothing glows (aGlow = 1, no twinkle) it matches the
   *  plain material apart from the ~1px analytic edge the shader path adds
   *  deliberately, so it's safe to leave on everywhere. */
  glow: boolean;
  /** corner rounding of the mark, INTERNAL 0 (square) to 1 (circle) */
  round: number;
  /** scales every formation's resting opacity, INTERNAL 0..3 (see DsField.intensity) */
  intensity: number;
  /** external 0..1 signal sampled once per frame (see DsField.energy) */
  energy?: (dt: number) => number;
  /** the host's target rect when it's open, else null (see DsField.gather) */
  gather?: () => { x: number; y: number; r?: number; s?: number } | null;
  /** a target pose in radians for the whole cloud, else null (see DsField.orient) */
  orient?: () => { rx: number; ry: number; speed?: number } | null;
  /** drag response, INTERNAL radians per NDC unit of pointer travel; 0 turns
   *  dragging off entirely (see DsField.spin) */
  spinGain: number;
  /** how fast a released drag dies, INTERNAL e-folds a second (see DsField.spin) */
  spinDamp: number;
  /** the host's light pockets, else absent (see DsField.spotlights) */
  spotlights?: FieldSpotlights;
  /** css px of each canvas edge the cloud must stay clear of (see DsField.inset) */
  inset?: FieldInset;
  /** morph duration, INTERNAL seconds (see DsField.transition) */
  morph: number;
  /** buffer headroom in points (see DsField.capacity) */
  capacity?: number;
  /** cursor-drag trail amount, INTERNAL 0..1 (see DsField.trail) */
  trail: number;
  /** pointer-following drift of the whole cloud, INTERNAL 0..1.5 (see DsField.parallax) */
  parallax: number;
  /** morph transit detour, INTERNAL world units (see DsField.shuffle) */
  shuffle: number;
  /** mobile point budget as a 0..1 FRACTION of the drawn count (see DsField.mobile) */
  mobile: number;
  /** prefers-reduced-motion: skip the resting breath + beat tremble and snap
   *  morphs so the field is static (the host also drops to frameloop "demand"). */
  reducedMotion?: boolean;
}) {
  // amounts arrive PRE-MAPPED to internal units by DsField (the public dials
  // are 0..10; the mapping lives at the boundary so the core stays tuned)
  const additiveOn = additive > 0;
  const geomRef = useRef<THREE.BufferGeometry>(null);
  const matRef = useRef<THREE.PointsMaterial>(null);
  const shaderRef = useRef<THREE.ShaderMaterial>(null);
  const groupRef = useRef<THREE.Group>(null);

  // rebuild targets when the viewport changes so layout-tracking
  // formations stay glued to the page columns; builds are lazy: only
  // the formations actually visited pay their build cost per viewport
  const { size, viewport, gl } = useThree();
  // the safe area as four numbers rather than as the object it arrived in: a
  // host that spells the inset inline hands us a fresh object every render, and
  // the rebuild below has to answer to what the numbers say, not to who
  // allocated them.
  const insetL = insetPx(inset?.left);
  const insetR = insetPx(inset?.right);
  const insetT = insetPx(inset?.top);
  const insetB = insetPx(inset?.bottom);
  // debounce the dims that drive the (expensive) formation rebuild so a scrolling
  // phone's URL-bar show/hide doesn't thrash 9000-point rebuilds. The live buffer
  // still tracks the real canvas each frame; only the rebuild waits to settle.
  // The safe area settles on the same clock, and for the same reason: a card
  // that animates open moves it every frame it is opening, and a build reads it.
  const [dims, setDims] = useState<FieldViewport>(() =>
    measureVp(
      size.width,
      size.height,
      viewport.width,
      viewport.height,
      insetL,
      insetR,
      insetT,
      insetB
    )
  );
  useEffect(() => {
    const id = setTimeout(() => {
      const next = measureVp(
        size.width,
        size.height,
        viewport.width,
        viewport.height,
        insetL,
        insetR,
        insetT,
        insetB
      );
      setDims((prev) => (sameVp(prev, next) ? prev : next));
    }, 150);
    return () => clearTimeout(id);
  }, [
    size.width,
    size.height,
    viewport.width,
    viewport.height,
    insetL,
    insetR,
    insetT,
    insetB,
  ]);
  const target = useMemo(() => {
    // a COPY: this one goes to third party build code, and the object the
    // engine measured its own frame into is not something a formation may write
    // to. A new one arrives only when the debounce above settles on a frame
    // that actually changed, which is exactly when the targets are stale.
    const vp: FieldViewport = { ...dims };
    const built = new Map<string, Float32Array>();
    return (k: string): Float32Array => {
      let v = built.get(k);
      if (!v) {
        // same fallback as the frame loop: an unregistered key builds the
        // first registered formation instead of crashing the canvas, and an
        // empty registry builds nothing at all
        v = resolveFormation(formations, k)?.build(vp) ?? new Float32Array(0);
        built.set(k, v);
      }
      return v;
    };
  }, [dims, formations]);

  const initialFormation = useRef(formation);
  // the mount look comes from the initial formation's own resolved opacity and
  // size, so the first second does not visibly ease down from a constant
  const initialLook = useMemo(() => {
    const cfg = resolveFormation(formations, initialFormation.current);
    const vp: FieldViewport = { ...dims };
    // an empty registry mounts with the default look (it draws nothing anyway)
    const rawO = vpValue(cfg?.opacity, vp, 0.3);
    // size is a 0..10 dial (absent = 5, the tuned nominal)
    const rawS = dial10(vpValue(cfg?.size, vp, 5), SIZE_MIN, BASE_SIZE, SIZE_MAX);
    return { o: rawO * intensity * (additiveOn ? 1 : 0.95), s: rawS };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // the live buffer allocates once at CAPACITY (the first build, or the
  // host's headroom via the capacity prop); the frame loop rewrites the drawn
  // slice from whatever targets currently say, so viewport resizes AND point
  // count changes apply without remounting. The tail beyond the first build is
  // filled with copies of it so no slot is ever uninitialized; a grow does not
  // read those, since it seeds each newborn at its OWN target (see vita).
  const positions = useMemo(() => {
    const first = target(initialFormation.current);
    const capPts = Math.max(capacity ?? 0, first.length / 3);
    const buf = new Float32Array(capPts * 3);
    buf.set(first);
    // an empty first build (an empty registry) has nothing to copy; the frame
    // loop keeps the draw range at zero until a formation exists
    if (first.length > 0) {
      for (let i = first.length; i < buf.length; i++) buf[i] = first[i % first.length];
    }
    return buf;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const fromArr = useMemo(() => positions.slice(), []);
  /* the cloud BEFORE the ambient effects: what the loop computed this frame up
   * to and including the formation's own live hook, without the breath, the
   * tremble, the cursor, the trail and the gather on top. It exists for one
   * reader, the morph capture. A morph used to start from `positions`, which
   * holds the fully displaced frame, and then the loop re-applied every
   * ambient effect onto that captured copy: each dot spent the first frames of
   * every transition wearing its own displacement twice, a coherent
   * whole-cloud pop right where the eye is watching for the morph to begin.
   * Captured bare, the base carries the SHAPE (flow displacement included, the
   * old hook stops running) and the ambient effects keep riding on top exactly
   * once, so the first morph frame draws within one frame-delta of the last
   * settled one. */
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const bare = useMemo(() => positions.slice(), []);
  const count = positions.length / 3; // capacity, in points
  // the drawn slice: targets shorter than capacity render their own length,
  // and a length change is births and deaths (a grow fades newborns in where
  // they belong, a shrink fades the excess out where it stands, and the draw
  // range clamps once the fade is over; see vita)
  const drawnN = useRef(count);
  const lastTargetN = useRef(-1);

  // per-point morph stagger + a per-point random (the shine clock offset)
  const staggers = useMemo(() => {
    const s = new Float32Array(count);
    for (let i = 0; i < count; i++) s[i] = fieldHash01(i) * STAGGER;
    return s;
  }, [count]);
  const rands = useMemo(() => {
    const s = new Float32Array(count);
    for (let i = 0; i < count; i++) s[i] = fieldHash01(i * 1.7 + 9.1);
    return s;
  }, [count]);
  /* per-point tables for the loop's own motion, drawn once per capacity. Every
   * number in here is a pure function of the point index, and the loop used to
   * re-derive them per point per frame: the shuffle's three hash draws (a sin
   * call each) alone were ~2.7 ms a frame at 9000 points, spent on values that
   * never change. `detour` is the shuffle's unit scatter, `gatherPull` the
   * attractor's per-point strength, and `wave` the phase terms of the resting
   * breath and the beat tremble: sin(wt + i*p) opens by the angle sum into
   * sin(wt)cos(ip) + cos(wt)sin(ip), so the loop pays two multiplies against
   * this table instead of a trig call, per channel. Eight to a point, cos
   * before sin, breath's two channels then the tremble's. Float32 throughout:
   * the buffer these feed is a Float32Array itself, so the table is already
   * finer than what the frame writes. */
  const tables = useMemo(() => {
    const detour = new Float32Array(count * 3);
    const gatherPull = new Float32Array(count);
    const wave = new Float32Array(count * 8);
    for (let i = 0; i < count; i++) {
      const i3 = i * 3;
      detour[i3] = (fieldHash01(i * 7.3 + 2.1) - 0.5) * 2;
      detour[i3 + 1] = (fieldHash01(i * 9.7 + 4.7) - 0.5) * 2;
      detour[i3 + 2] = (fieldHash01(i * 5.9 + 3.3) - 0.5) * 2;
      gatherPull[i] = 0.12 + fieldHash01(i * 3.7 + 1.3) * 0.08;
      const w = i * 8;
      wave[w] = Math.cos(i * 0.41);
      wave[w + 1] = Math.sin(i * 0.41);
      wave[w + 2] = Math.cos(i * 0.57);
      wave[w + 3] = Math.sin(i * 0.57);
      wave[w + 4] = Math.cos(i * 1.7);
      wave[w + 5] = Math.sin(i * 1.7);
      wave[w + 6] = Math.cos(i * 2.3);
      wave[w + 7] = Math.sin(i * 2.3);
    }
    return { detour, gatherPull, wave };
  }, [count]);
  // per-point glow (1 = base). Rewritten each frame from the formation's `glow`
  // hook, reset to all-1 once when leaving a glowing formation.
  const glowBuf = useMemo(() => new Float32Array(count).fill(1), [count]);
  /* per-point LIFE, for count changes: 1 is a settled dot, 0 an unborn or dead
   * one, and the ease between them is how a count change reads as dots
   * APPEARING and DISAPPEARING rather than as the cloud reshuffling. A grown
   * dot spawns AT its own target with life 0 and fades in through the alpha
   * (the aGlow path); a shrunk dot holds its place and fades out where it
   * stands until the draw range clamps it away on settle. No dot travels for a
   * count change any more, so the shuffle detour has nothing to detour and the
   * old fan-out-of-survivors flight (which read as a remix of the whole cloud)
   * is gone. Needs the shader path like everything alpha; on the plain
   * material a count change lands in place without the fade. */
  const vita = useMemo(() => new Float32Array(count).fill(1), [count]);
  // whether any life is still easing (or any dying dot is still drawn), so the
  // per-point work runs only around a count change and never at rest
  const vitaLive = useRef(false);
  // the SEED for the material's uniforms, not the object the draw reads: r3f
  // copies each holder into one of the material's own (see the frame loop's
  // `uni`). The array values are shared by reference, so the buffers below are
  // the very ones uploaded; the scalars are not, so nothing writes them here.
  const uniforms = useMemo(
    () => ({
      uColor: { value: new THREE.Color(tint) },
      uOpacity: { value: initialLook.o },
      uSize: { value: initialLook.s },
      uScale: { value: 300 },
      uTime: { value: 0 },
      uShine: { value: 0 },
      uRound: { value: 0 },
      uAdditive: { value: 0 },
      // the colored pockets, PACKED: only the tinted ones are written, uSpotN
      // says how many, and at 0 (no tint anywhere) the shader's loop exits on
      // its first test and none of these arrays are ever read.
      uTint: { value: new Float32Array(SPOT_MAX * 3) },
      uTintAmt: { value: new Float32Array(SPOT_MAX) },
      uSpot: { value: new Float32Array(SPOT_MAX * 3) },
      uSpotInv: { value: new Float32Array(SPOT_MAX).fill(1) },
      uSpotN: { value: 0 },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );
  // cursor-drag trail state: per-point displacement + velocity, and the
  // cursor's last z=0-plane position for its velocity estimate
  const tDx = useMemo(() => new Float32Array(count), [count]);
  const tDy = useMemo(() => new Float32Array(count), [count]);
  const tVx = useMemo(() => new Float32Array(count), [count]);
  const tVy = useMemo(() => new Float32Array(count), [count]);
  const prevCur = useRef({ x: 0, y: 0, has: false });
  const curO = useRef(initialLook.o);
  const curS = useRef(initialLook.s);
  /* THE STYLE EASE, extended to every remaining look input. Opacity and size
   * have always glided toward their targets, so a host scrubbing `intensity`
   * saw motion; a host scrubbing `shine`, `round`, `additive` or the tint saw
   * a step. Same engine, two different answers to the same kind of change.
   * These refs close that: the shader is fed EASED values at the same 2.4 rate
   * the opacity rides, so every look change lands as a transition, at zero
   * cost beyond four lerps a frame. Seeded from the mount props, so the first
   * frame is the look that was asked for, not an ease up from nothing. The
   * tint eases as a COLOR (a lerp through RGB), and the blending mode follows
   * the EASED additive amount rather than the prop, so a halo dialled away
   * fades out before the blend flips instead of flipping mid-halo. */
  const curShine = useRef(shine);
  const curRound = useRef(round);
  const curAdd = useRef(additive);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const curTint = useMemo(() => new THREE.Color(tint), []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const tintTarget = useMemo(() => new THREE.Color(tint), []);
  // the string the target was parsed from, so a live color only reparses when
  // it actually moves (the same trick the spotlight tints use)
  const tintKey = useRef(tint);
  const to = useRef<string>(initialFormation.current);
  const phase = useRef(MORPH_NOMINAL + 1);
  // the morph duration the phase above is currently measured in. A transition
  // dial change mid-morph rescales the phase into the new duration, so what
  // stays fixed is the FRACTION travelled and nothing snaps.
  const morphRef = useRef(MORPH_NOMINAL);
  const sway = useRef(0);
  // the eased POSE angles (sway + orient), kept off the group the way the fit
  // is kept off the scale: the drag angle rides on the same two axes, so easing
  // toward a target read back off a dragged group would chase its own tail and
  // unwind every turn the hand put in.
  const poseY = useRef(0);
  const poseX = useRef(0);
  // the turn the drag has put in, advanced by field-drag once a frame
  const spin = useMemo(createSpin, []);
  // whether the group's position has been placed at all yet. The safe-area
  // shift is a LAYOUT, not a motion: it lands whole on the first frame instead
  // of gliding in from the canvas center, and every frame after that eases the
  // way the parallax always has.
  const posSeeded = useRef(false);
  // the eased layout fit, kept OFF the rendered scale: the beat pump multiplies
  // the group scale, so reading it back as the fit state would feed the pump
  // into the next frame's lerp. This ref is the clean layout value.
  const fitRef = useRef(1);
  // whether the glow buffer currently holds non-trivial values, so we can reset
  // it to all-1 exactly once when a glowing formation gives way to a plain one.
  const glowActive = useRef(false);
  // gather attractor: a smoothed (laggy) center + a fade amount, so dots pool
  // behind the host's open target and trail it on a drag; gs is the host's
  // strength dial (gather.s), smoothed so slider scrubs glide
  const gx = useRef(0);
  const gy = useRef(0);
  const gAmt = useRef(0);
  const gs = useRef(1);
  const gScale2 = useRef(GATHER_SCALE2);
  // spotlights: one slot per pocket, owned and resolved by field-spot once a
  // frame (see SpotSlots there for the slot contract)
  const spot = useMemo(createSpotSlots, []);
  // the cursor's eased presence and the mode the fade-out keeps applying after
  // the prop flips to "off", stepped by field-cursor once a frame
  const cursor = useMemo(createCursorPresence, []);
  // whether any trail displacement is still live, so the spring keeps running
  // home after the dial drops to 0 instead of freezing mid-wake (and popping
  // back whenever the dial returns)
  const trailLive = useRef(false);
  // cursor physics stay off until a real pointer moves over the canvas; the
  // drag rides the same listeners (see useFieldPointer)
  const { pointer, drag } = useFieldPointer(spinGain > 0);

  useEffect(() => {
    if (to.current === formation) return;
    // the morph starts from the BARE cloud, not the displaced one: the ambient
    // effects keep being applied each frame, so a capture that included them
    // would wear them twice for the first frames of every transition (see bare)
    fromArr.set(bare);
    to.current = formation;
    phase.current = 0;
  }, [formation, fromArr, bare]);

  useFrame((state, delta) => {
    // the two objects this loop writes, read out of their refs once: React only
    // ever sets them between frames, so one read holds for the whole frame.
    const group = groupRef.current;
    const geom = geomRef.current;
    // the transition dial arrives as a duration in seconds and may move at any
    // time, mid-morph included. What has to stay continuous is the FRACTION
    // travelled, so the phase is rescaled into the new duration rather than
    // left in the old one: a point 40% of the way through stays 40% through,
    // and only the seconds it has left change.
    if (morph !== morphRef.current) {
      phase.current *= morph / morphRef.current;
      morphRef.current = morph;
    }
    phase.current += delta;
    const f = to.current;
    const cfg = resolveFormation(formations, f);
    if (!cfg) {
      // an empty registry draws nothing, even when capacity reserved a buffer
      if (geom) geom.setDrawRange(0, 0);
      return;
    }
    const toArr = target(f);

    // variable point count: draw the target's own length (≤ capacity), and
    // treat a length change as BIRTHS AND DEATHS: growth spawns dots at their
    // own targets fading in, shrink fades the excess out where it stands
    // until the draw range clamps on settle (see vita).
    // The mobile budget scales the resolved count below 768 css px, computed
    // on the DEBOUNCED dims (the same settle the rebuild waits for) and
    // applied HERE so a budget change morphs like any other count change.
    // Capacity clamps FIRST: the budget is a fraction of what actually gets
    // drawn, and an over-capacity build draws the capacity, not its own length.
    const buildN = toArr.length / 3;
    const mobileScale = dims.w < 768 ? mobile : 1;
    const targetN = Math.round(Math.min(buildN, count) * mobileScale);
    if (targetN < 1) {
      // a zeroed mobile budget draws nothing; positions hold where they were,
      // so a later grow morphs back out of the parked cloud
      if (geom) geom.setDrawRange(0, 0);
      drawnN.current = 0;
      lastTargetN.current = 0;
      return;
    }
    if (lastTargetN.current === -1) {
      lastTargetN.current = targetN;
      drawnN.current = targetN;
    } else if (targetN !== lastTargetN.current) {
      // from the BARE cloud, the same capture a formation change makes and for
      // the same reason: the ambient effects ride on top exactly once
      fromArr.set(bare);
      const oldN = lastTargetN.current;
      // A COUNT CHANGE IS BIRTHS AND DEATHS, never a reshuffle: a grown dot
      // spawns AT its own target with life 0 and fades in (see vita), so it
      // travels nowhere, takes no shuffle detour, and the dots that were
      // already there do not watch a third of the cloud fly across the shape.
      // Only the dots that were truly PARKED are seeded: a grow that
      // interrupts an in-flight shrink finds dots above oldN still on screen
      // (drawnN has not clamped yet), holding their own fresh coordinates, and
      // those simply ease their life back up where they stand. Trail state
      // resets on the newborns: a respawned index must not pop in mid-wake
      // from its previous life.
      if (targetN > oldN) {
        const st = buildN / targetN;
        const parked = Math.max(oldN, drawnN.current);
        for (let i = parked; i < targetN; i++) {
          const b3 = Math.min(Math.round(i * st), buildN - 1) * 3;
          const i3 = i * 3;
          fromArr[i3] = toArr[b3];
          fromArr[i3 + 1] = toArr[b3 + 1];
          fromArr[i3 + 2] = toArr[b3 + 2];
          positions[i3] = toArr[b3];
          positions[i3 + 1] = toArr[b3 + 1];
          positions[i3 + 2] = toArr[b3 + 2];
          bare[i3] = toArr[b3];
          bare[i3 + 1] = toArr[b3 + 1];
          bare[i3 + 2] = toArr[b3 + 2];
          vita[i] = 0;
          tDx[i] = 0;
          tDy[i] = 0;
          tVx[i] = 0;
          tVy[i] = 0;
        }
      }
      vitaLive.current = true;
      lastTargetN.current = targetN;
      drawnN.current = Math.max(drawnN.current, targetN);
      phase.current = 0;
    }
    // how a drawn dot reads the build. A trimmed field DECIMATES: dot i takes
    // build point round(i * stride), so the drawn subset spreads across the
    // WHOLE shape. Cutting the tail instead would crop any formation laid out
    // in index order (lattice and horizon walk a grid row by row, so a phone
    // would show a partial grid rather than a sparser one). It reads off the
    // build length and targetN, so it can only move on a formation or count
    // change, the very changes that start a morph: the remap is never a jump.
    // Untrimmed it is exactly 1 and the rounding is exact, so the full-count
    // path reads index i as it always did.
    const stride = buildN / targetN;
    // the dev-console "THREE.Clock deprecated, use THREE.Timer" warning is
    // upstream: fiber v9 constructs state.clock itself and no released version
    // avoids it yet (pmndrs/react-three-fiber#3741). It clears with the fiber
    // release that ships state.timer; nothing on our side to migrate.
    const t = state.clock.elapsedTime;
    // formation dials resolve through dial10 (absent = 5, the tuned nominal)
    const chaos = dial10(cfg.chaos ?? 5, 0, 1, 5);
    const reach = dial10(cfg.cursorReach ?? 5, 0, 2.2, 3); // the effect radius, world units
    const rr = reach * reach; // the loop compares squared distances, so keep it squared
    const pOn = pointer.current.on;
    // THE CURSOR'S PRESENCE, stepped by field-cursor (the note over
    // cursorPresence there is the why): the force ramps in as the pointer
    // arrives, relaxes out where it was last seen, and a live-to-live mode
    // change dips through the ease before the new physics are adopted.
    cursorPresence(cursor, mode, pOn, delta);
    const cursorMode = cursor.mode;
    const cursorOn = cursor.amt > 0;
    // force scales how far points are pushed, through the presence above
    const cf = dial10(cfg.cursorForce ?? 5, 0, 0.85, 3) * cursor.amt;
    // repel is the one mode that pushes by a DISTANCE rather than by a share of
    // one (it has to: opening a cavity means moving the dots that sit exactly
    // under the cursor, and a share of nothing is nothing). So its push has to
    // be a distance its own reach can hold. Left alone, a narrow forceful
    // cursor shoves points more than a full reach out, further than the points
    // outside them travel, and the cloud folds over itself into a bright ring
    // at the lip of the cavity. Below the nominal reach the push comes down
    // with it; at and above it this is 1 and nothing about repel changes.
    const rf = cf * (reach < 2.2 ? reach / 2.2 : 1);
    // external energy (e.g. the soundtrack's low-end envelope): sampled ONCE a
    // frame and reused by every point below. 0 when nothing drives it. The
    // gamma curve (b) makes the response gradual: the basic/steady low end
    // barely moves the field while strong beats drive it near full, so it reads
    // as "pulse + tremble on the hits", not a constant buzz.
    const beat = energy ? energy(delta) : 0;
    // reduced motion zeroes the pump entirely: no scale swell, no flash
    const b = !reducedMotion && beat > 0.002 ? Math.pow(beat, BEAT_GAMMA) : 0;

    // figures scale down on narrow viewports; ambient fields keep
    // their by-design overflow. The beat pumps the rendered scale on top of the
    // layout fit, so the whole cloud swells a touch on every hit and settles
    // between, the spatial half of the pulse (brightness is the other half).
    const fitTarget = cfg.fit ? Math.min(1, state.viewport.width / FIT_WIDTH) : 1;
    fitRef.current += (fitTarget - fitRef.current) * easeRate(delta, POSE_RATE);
    const fit = fitRef.current;
    if (group) group.scale.setScalar(fit * (1 + b * 0.045));

    // parallax drifts the whole GROUP (the block at the end of this loop), so
    // every world-to-group-local mapping below must subtract the group's
    // translation or the cursor effects land offset while the cloud is
    // drifted. Read before this frame's parallax write: one frame of lag,
    // invisible at the ease rates involved.
    const gpx = group ? group.position.x : 0;
    const gpy = group ? group.position.y : 0;
    const gpz = group ? group.position.z : 0;
    // DRAG TO SPIN. The turn advances HERE, ahead of every world-to-group-local
    // mapping below, and lands on the group before GINV is read: a throw can
    // cross a radian a second, an angle the eye catches, so the light pockets,
    // the cursor physics, the floor and the wake all come back through THIS
    // frame's angle rather than the last one's. The turn itself, the coast and
    // the way home when the dial says off all live in field-drag (advanceSpin
    // says how); the banked travel is consumed there, so no event is dropped
    // between frames.
    advanceSpin(spin, drag.current, spinGain, spinDamp, delta, reducedMotion);
    // the turn lands on the group HERE, ahead of the GINV read: the way home
    // crosses a radian a second at the start, the same order a throw does, so
    // the light pockets, the cursor physics, the floor and the wake have to
    // come back through this frame's angle rather than the last one's.
    //
    // GINV is that trip back. The group also TURNS (the drag just applied, plus
    // the sway + orient written at the end of this loop), so a world-space
    // payload has to come back through the rotation too, not only the
    // translation. Read here: the drag is current, the pose carries the same
    // one-frame lag the translation does.
    if (group) {
      group.rotation.y = poseY.current + spin.y;
      group.rotation.x = poseX.current + spin.x;
      GINV.copy(group.quaternion).invert();
    } else {
      GINV.identity();
    }

    // floor formations: project the cursor onto their ground plane so the
    // cursor physics act within it (points slide along the floor instead of
    // lifting in screen-y)
    let fx = 0;
    let fz = 0;
    let floorOn = false;
    // gated on the eased presence, not the raw pointer: the ground cavity
    // relaxes out where the pointer was last seen instead of snapping shut
    if (cfg.floor && cursorOn) {
      NDC.set(pointer.current.x, pointer.current.y);
      // the plane lives in world space, so the group's parallax lift rides
      // on the formation's own floor height
      PLANE.constant = -(cfg.floor.y + gpy);
      state.raycaster.setFromCamera(NDC, state.camera);
      if (state.raycaster.ray.intersectPlane(PLANE, HIT)) {
        // the hit is world space: undo the drift, the turn and the fit to get
        // the spot in the floor's own frame. The turn matters now that the
        // cloud can spin: a y-axis turn keeps a horizontal plane horizontal
        // (so the world raycast above still finds the floor), but it swings
        // the floor's OWN x and z out from under the cursor, and only the
        // inverse rotation puts them back.
        W_LOCAL.set(HIT.x - gpx, HIT.y - gpy, HIT.z - gpz)
          .applyQuaternion(GINV)
          .divideScalar(fit);
        fx = W_LOCAL.x;
        fz = W_LOCAL.z;
        floorOn = true;
      }
    }

    // cursor ray for the xy physics: the effect must land directly under the
    // pointer, so we project the cursor to EACH point's real depth (a flat
    // z=0 projection drifts the effect toward center for points behind z=0,
    // which reads as the effect drifting toward center). Ray computed once.
    // the trail also needs the projection when plain physics are off.
    // The ray comes back into GROUP-LOCAL space HERE, once, instead of the
    // per-point round trip it used to make: undo the parallax drift, undo the
    // group's turn, undo the fit. The direction takes the turn only, a uniform
    // scale leaving a direction pointing where it pointed. Under no rotation
    // this is the same arithmetic the loop used to do point by point, and with
    // the cloud turning it is the only version that still lands under the
    // pointer: the loop below then reads a local ray against local depths and
    // never touches the group transform again.
    const trailAmt = reducedMotion ? 0 : trail;
    let rOX = 0, rOY = 0, rOZ = 0, rDX = 0, rDY = 0, rDZ = -1;
    let rayOn = false;
    // the physics need the ray while any presence remains (the coords go stale
    // and the fade relaxes in place); the trail only while the pointer is real,
    // since a parked cursor drags nothing
    if (!cfg.floor && (cursorOn || (pOn && trailAmt > 0))) {
      NDC.set(pointer.current.x, pointer.current.y);
      state.raycaster.setFromCamera(NDC, state.camera);
      const ro = state.raycaster.ray.origin;
      const rd = state.raycaster.ray.direction;
      W_LOCAL.set(ro.x - gpx, ro.y - gpy, ro.z - gpz).applyQuaternion(GINV).divideScalar(fit);
      rOX = W_LOCAL.x; rOY = W_LOCAL.y; rOZ = W_LOCAL.z;
      W_LOCAL.set(rd.x, rd.y, rd.z).applyQuaternion(GINV);
      rDX = W_LOCAL.x; rDY = W_LOCAL.y; rDZ = W_LOCAL.z;
      // a spinning cloud passes through EDGE ON twice a turn, and there the ray
      // runs parallel to the depth planes it is being marched against: the
      // crossing runs off to infinity (and to NaN at exactly parallel, which
      // the trail would then hold in its velocity state for good). The
      // projection is meaningless well before that, so the frames within about
      // three degrees of parallel simply have no cursor: the physics are inert
      // there anyway, and dropping the ray also re-seeds the trail's previous
      // position, so nothing snaps when the cloud turns back face on. Unturned,
      // rDZ is the camera's own -1 and this never fires.
      rayOn = Math.abs(rDZ) > 0.05;
    }

    // cursor-drag trail: estimate the cursor's velocity on the cloud's OWN
    // z = 0 plane; points it sweeps pick that velocity up in the loop below,
    // smear along the path it actually traced, and spring home (elastic wake,
    // not sprites). A parked cursor drags nothing.
    // The crossing comes off the local ray that is already in hand (march it to
    // z = 0), so the trail no longer raycasts a second world plane of its own:
    // one plane, one frame of the pointer, and the wake is measured in the
    // frame the displacements live in. Undrifted and unturned that is the same
    // point the world z = 0 plane gave, and turning it is what keeps the drag
    // pointing where the cursor actually went once the cloud spins.
    let cvx = 0;
    let cvy = 0;
    let grabbing = false;
    if (trailAmt > 0 && pOn && rayOn) {
      const tz = -rOZ / rDZ;
      const cxw = rOX + tz * rDX;
      const cyw = rOY + tz * rDY;
      const pc = prevCur.current;
      if (pc.has) {
        const idt = 1 / Math.max(delta, 1e-4);
        cvx = (cxw - pc.x) * idt;
        cvy = (cyw - pc.y) * idt;
        const sp = Math.hypot(cvx, cvy);
        if (sp > 9) {
          const c = 9 / sp;
          cvx *= c;
          cvy *= c;
        }
        grabbing = sp > 0.35;
      }
      pc.x = cxw;
      pc.y = cyw;
      pc.has = true;
    } else {
      prevCur.current.has = false;
    }

    const liveCtx = LIVE_CTX;
    liveCtx.t = t;
    const hasGlow = !!cfg.glow;
    // whether the trail's spring has anything left to do: the dial being up,
    // or a wake still relaxing after it went down (see the loop's trail block)
    const trailRun = trailAmt > 0 || trailLive.current;
    let trailAny = false;
    // whether any life is still easing after a count change, and the rate it
    // eases at: tied to the morph duration, so the transition dial paces the
    // births and deaths exactly as it paces everything else. Reduced motion
    // snaps them, the way it snaps the morph.
    const vitaOn = vitaLive.current;
    const vk = reducedMotion ? 1 : easeRate(delta, 3.2 / morph);
    let vitaAny = false;

    // the frame's halves of the breath and the tremble (the angle sums the
    // `wave` table carries the other halves of), computed once here rather
    // than as a trig call per point. chaos 0 skips the breath outright: it
    // was adding an exact zero to every point.
    const { detour, gatherPull, wave } = tables;
    const breathing = !reducedMotion && chaos > 0;
    const trembling = b > 0.001;
    let bs1 = 0, bc1 = 0, bs2 = 0, bc2 = 0;
    if (breathing) {
      const amp = 0.012 * chaos;
      bs1 = Math.sin(t * 0.85) * amp;
      bc1 = Math.cos(t * 0.85) * amp;
      bs2 = Math.sin(t * 0.7) * amp;
      bc2 = Math.cos(t * 0.7) * amp;
    }
    let ts1 = 0, tc1 = 0, ts2 = 0, tc2 = 0;
    if (trembling) {
      const amp = b * 0.024;
      ts1 = Math.sin(t * 22) * amp;
      tc1 = Math.cos(t * 22) * amp;
      ts2 = Math.sin(t * 25) * amp;
      tc2 = Math.cos(t * 25) * amp;
    }

    // gather: ease the attractor toward the host's target center (the lag is what
    // makes the pooled dots trail on a fast drag) and fade the whole effect in/out
    // with the target's open state.
    const gNow = gather ? gather() : null;
    if (gNow) {
      const eAim = easeRate(delta, EASE_AIM);
      gx.current += (gNow.x - gx.current) * eAim;
      gy.current += (gNow.y - gy.current) * eAim;
      // s is a 0..10 dial (5 = the nominal half-strength pull); absent, the
      // pull runs at full strength, the pre-dial contract
      gs.current += ((gNow.s != null ? dial10(gNow.s, 0, 0.5, 1) : 1) - gs.current) *
        easeRate(delta, EASE_STRENGTH);
      // r scales the falloff spread; absent, the whole-page default holds.
      // Presence-gated (not truthiness) and floored, so a host passing a tiny
      // or zero r gets the tightest sane pool instead of the page-wide default
      gScale2.current = gNow.r != null ? Math.max(gNow.r, 0.05) ** 2 * 7.8 : GATHER_SCALE2;
    }
    gAmt.current += ((gNow ? 1 : 0) - gAmt.current) * easeRate(delta, EASE_PRESENCE);
    const gathering = gAmt.current > 0.003;
    // the presence and the strength dial multiply the same way on every point
    const gAmtGs = gAmt.current * gs.current;
    // the attractor's center is world space, like the spotlight's, so it takes
    // the same trip into the cloud's frame: drift out, turn out, fit out. Done
    // ONCE here rather than per point. Undrifted, unturned and unfitted it is
    // the plain subtraction the loop used to do; with the cloud turning it is
    // what keeps the pool under the host's target instead of orbiting with the
    // cloud. The falloff scale is a squared WORLD distance, so it makes the
    // same trip through the fit to stay the same pool on screen.
    W_LOCAL.set(gx.current - gpx, gy.current - gpy, -gpz).applyQuaternion(GINV).divideScalar(fit);
    const gLX = W_LOCAL.x;
    const gLY = W_LOCAL.y;
    const gScaleL2 = gScale2.current / (fit * fit);

    // THE uniforms the draw reads. r3f does not hand the material our uniforms
    // object: it copies each holder into one of its own and keeps that target
    // stable (applyProps, "ShaderMaterial uniforms must keep a stable target
    // reference"). The holder's VALUE is copied by reference, so writing INTO
    // an array value lands on both objects, but assigning a scalar `.value` on
    // our copy lands on nothing that is ever uploaded. Every uniform write in
    // this loop goes through this one, arrays included, so the rule is one rule
    // and not a thing to remember per uniform. The fallback is the plain
    // material path, where there is no shader to write to at all.
    const uni: Record<string, THREE.IUniform> = shaderRef.current
      ? shaderRef.current.uniforms
      : uniforms;

    // spotlights: the host's light pockets, resolved by field-spot once per
    // frame (the note over resolveSpotlights there is the contract). It packs
    // the pockets that actually brighten into SPOT_LX and friends, in
    // group-local units, and returns how many; the per-point block below walks
    // exactly that many. The tinted ones land straight in the shader's uniform
    // arrays through `uni`. An absent prop costs one branch a frame.
    const litN = resolveSpotlights(spot, spotlights, uni, delta, gpx, gpy, gpz, GINV, fit);

    // once the morph has fully settled every stagger clamps to e = 1 and
    // the lerp collapses to toArr, so skip the per-point easing entirely
    const settled = reducedMotion || phase.current >= morph;
    if (settled && drawnN.current !== targetN) drawnN.current = targetN;
    const n = drawnN.current;
    if (geom && geom.drawRange.count !== n) {
      geom.setDrawRange(0, n);
    }

    for (let i = 0; i < n; i++) {
      const i3 = i * 3;
      // a dot past the target count is DYING: it holds the place it stands in
      // and fades out through its life (see vita), instead of folding onto a
      // survivor, so a shrink reads as dots leaving rather than the cloud
      // reshuffling. Its glow keeps a build index of its own: the modulo is
      // the index itself when the build still holds it (the mobile trim), and
      // a SPREAD across the build when a rebuild made the build shorter, so a
      // dying shroud fades with its own varied texture rather than the whole
      // of it wearing one point's brightness.
      const dying = i >= targetN;
      // the build index this dot draws: through the stride (see above).
      // Clamped for safety only; round(i * stride) cannot leave the build.
      const bi = dying
        ? i % buildN
        : Math.min(Math.round(i * stride), buildN - 1);
      const ti3 = bi * 3;
      // the position this dot lands on: its slot in the target build, or, for
      // a dying dot, the very spot the count change caught it at
      const tx = dying ? fromArr[i3] : toArr[ti3];
      const ty = dying ? fromArr[i3 + 1] : toArr[ti3 + 1];
      const tz = dying ? fromArr[i3 + 2] : toArr[ti3 + 2];
      let e = 1;
      let x = tx;
      let y = ty;
      let z = tz;
      if (!settled) {
        const stag = staggers[i];
        const lp = THREE.MathUtils.clamp(
          (phase.current / morph - stag) / (1 - stag),
          0,
          1
        );
        e = easeInOutCubic(lp);
        // the straight line from where the dot was to where it is going. At
        // shuffle 0 this is the whole of the transit: the ease only sets the
        // pace along the segment, never bends it.
        x = fromArr[i3] + (tx - fromArr[i3]) * e;
        y = fromArr[i3 + 1] + (ty - fromArr[i3 + 1]) * e;
        z = fromArr[i3 + 2] + (tz - fromArr[i3 + 2]) * e;
        // shuffle: a per-point detour off that line, drawn once from the point's
        // index (so the same morph scatters the same way every time, and the
        // draw sits in the `detour` table rather than costing three hash sins
        // a point a frame) and carried by a bump envelope that is exactly zero
        // at both endpoints, so the start and end poses are untouched however
        // wide the swirl. `arc` is the detour's half-width in WORLD UNITS at
        // the peak; the gate eases it off for a point with nowhere to go, so a
        // count tick that leaves a dot where it stood cannot make it shiver.
        if (shuffle > 0) {
          const mx = tx - fromArr[i3];
          const my = ty - fromArr[i3 + 1];
          const mz = tz - fromArr[i3 + 2];
          const md2 = mx * mx + my * my + mz * mz;
          const arc = 4 * e * (1 - e) * shuffle * Math.min(1, md2 / SHUFFLE_GATE2);
          x += detour[i3] * arc;
          y += detour[i3 + 1] * arc;
          z += detour[i3 + 2] * arc;
        }
      }

      // formation-specific life + per-point glow share the same ctx, and both
      // speak the BUILD index (bi): a formation's per-point tables are sized to
      // its own build, and a trimmed field's dot i draws build point bi, not i.
      // Dying dots (i ≥ targetN, only mid-shrink) skip `live`, whose hooks may
      // run once-a-frame work on index 0, but keep their glow through the
      // spread bi above, so the fading shroud keeps its own texture.
      // The hook runs BEFORE the ambient effects below: its displacement is
      // part of the SHAPE, so it belongs inside the bare capture, and it reads
      // the shape's own position rather than the shape plus this frame's
      // breath.
      if (cfg.live || hasGlow) {
        liveCtx.i = bi;
        liveCtx.z = z;
        liveCtx.e = e;
        if (cfg.live && i < targetN) {
          const next = cfg.live(x, y, liveCtx);
          x = next[0];
          y = next[1];
          // the triple form also moves in depth; the pair form leaves z as built
          if (next.length === 3) {
            z = next[2];
            liveCtx.z = z;
          }
        }
        if (hasGlow) {
          glowBuf[i] = cfg.glow!(bi, liveCtx);
        }
      }

      // THE BARE CLOUD, captured here: the shape this frame, before the
      // ambient effects (breath, tremble, cursor, trail, gather) land on top.
      // A morph starts from this copy, so the effects are never worn twice
      // (see the memo where `bare` is allocated).
      bare[i3] = x;
      bare[i3 + 1] = y;
      bare[i3 + 2] = z;

      // resting breath, gentle and slow (off under reduced motion, and at
      // chaos 0 skipped rather than adding an exact zero). The trig opened by
      // the angle sum against the wave table: same motion, no sin per point.
      if (breathing) {
        const w = i * 8;
        x += bs1 * wave[w] + bc1 * wave[w + 1];
        y += bc2 * wave[w + 2] - bs2 * wave[w + 3];
      }

      // beat tremble: the per-point shimmer the cloud picks up on a hit: the
      // texture from the first pass, but lower and gated by `b`, so it's near
      // still on the basic low end and only really trembles on a strong beat.
      // Together with the scale + brightness pump this is the "pulse AND
      // tremble" feel. Same angle-sum treatment as the breath above.
      if (trembling) {
        const w = i * 8;
        x += ts1 * wave[w + 4] + tc1 * wave[w + 5];
        y += tc2 * wave[w + 6] - ts2 * wave[w + 7];
      }

      // cursor physics. floor formations push within their ground plane (xz);
      // everything else within the camera-facing plane (xy), projecting the
      // cursor to each point's own depth so it lands true under the pointer.
      // pd2 is the real squared distance; d2 is normalized by reach². Each mode
      // gates at its OWN rim and takes its force from cursorFalloff, which
      // reaches exactly zero there, so the cloud has no ring around the cursor
      // where the effect stops.
      if (floorOn) {
        const dx = x - fx;
        const dz = z - fz;
        const pd2 = dx * dx + dz * dz;
        const d2 = pd2 / rr;
        if (cursorMode === "attract") {
          if (d2 < CURSOR_RIM2_ATTRACT) {
            // a share of the way in, never a distance: see cursorPull
            const k = cursorPull(d2, cf);
            x -= dx * k;
            z -= dz * k;
          }
        } else if (d2 < CURSOR_RIM2_REPEL) {
          // repel, and vortex with it: there is no floor swirl, so that mode
          // falls back to this push. It slides the grid away from the cursor
          // along the ground rather than lifting it toward the camera.
          const d = Math.sqrt(pd2) || 0.001;
          const fr = cursorFalloff(d2, CURSOR_RIM2_REPEL, CURSOR_GAUSS_REPEL) * CURSOR_PUSH_REPEL * rf;
          x += (dx / d) * fr;
          z += (dz / d) * fr;
        }
      } else if (rayOn) {
        // project the local cursor ray to THIS point's own depth so the effect
        // sits exactly under the pointer. Both are group-local now (the ray was
        // mapped in above), so this is three lines of ray march and no
        // transform at all.
        const tt = (z - rOZ) / rDZ;
        const cx = rOX + tt * rDX;
        const cy = rOY + tt * rDY;
        const dx = x - cx;
        const dy = y - cy;
        const pd2 = dx * dx + dy * dy;
        const d2 = pd2 / rr;
        // cursorMode, not mode: the fade-out after "off" keeps the physics it
        // was last seen with, at a force the presence has already scaled down
        if (cursorMode === "repel" && cursorOn) {
          if (d2 < CURSOR_RIM2_REPEL) {
            const d = Math.sqrt(pd2) || 0.001;
            const fr = cursorFalloff(d2, CURSOR_RIM2_REPEL, CURSOR_GAUSS_REPEL) * CURSOR_PUSH_REPEL * rf;
            x += (dx / d) * fr;
            y += (dy / d) * fr;
          }
        } else if (cursorMode === "attract" && cursorOn) {
          if (d2 < CURSOR_RIM2_ATTRACT) {
            // a share of the way in, never a distance: see cursorPull
            const k = cursorPull(d2, cf);
            x -= dx * k;
            y -= dy * k;
          }
        } else if (cursorMode === "vortex" && cursorOn) {
          if (d2 < CURSOR_RIM2_VORTEX) {
            // the same share, spent sideways: the swirl turns a point by
            // atan(k) about the cursor whatever its distance, so the rings
            // shear against each other instead of the inner ones winding up.
            // The 0.18 is the same slight drift inward it always had, and it
            // is a share now too, so it cannot overshoot the middle either.
            const k = cursorSwirl(d2, cf);
            x += -dy * k - dx * k * 0.18;
            y += dx * k - dy * k * 0.18;
          }
        }

        // trail grab: a moving cursor hands its velocity to the points it
        // sweeps (at their own depth), scaled by the trail amount
        if (grabbing && pd2 < 0.6) {
          const k = Math.exp(-pd2 * 3.5) * trailAmt * Math.min(1, delta * 14);
          tVx[i] += cvx * k;
          tVy[i] += cvy * k;
        }
      }

      // trail integration: displaced points spring home with damping, and the
      // wake stretches along wherever the cursor went, then relaxes. Idle
      // points cost one comparison. It keeps running while any wake is still
      // live (trailRun), so a dial dropped to 0 lets the spring carry every
      // displaced dot home instead of freezing the wake where it was, and
      // stops for good once the last dot settles.
      if (trailRun) {
        let dvx = tVx[i];
        let dvy = tVy[i];
        let ddx = tDx[i];
        let ddy = tDy[i];
        if (dvx * dvx + dvy * dvy + ddx * ddx + ddy * ddy > 1e-7) {
          trailAny = true;
          dvx -= ddx * 30 * delta;
          dvy -= ddy * 30 * delta;
          const dampF = Math.exp(-delta * 6);
          dvx *= dampF;
          dvy *= dampF;
          ddx += dvx * delta;
          ddy += dvy * delta;
          x += ddx;
          y += ddy;
          tVx[i] = dvx;
          tVy[i] = dvy;
          tDx[i] = ddx;
          tDy[i] = ddy;
        }
      }

      // gather: every dot is drawn GENTLY toward the smoothed attractor center
      // with a smooth, whole-page falloff (no hard radius, so there's no visible
      // edge where it ends). A soft lean that pools toward the open target and
      // trails it on a drag, easing back on close.
      if (gathering) {
        // the center arrived in group space above, so the pool sits under the
        // host's target however the cloud is drifted, turned or scaled; the
        // per-point strength comes off the gatherPull table, not a hash a frame
        const dgx = gLX - x;
        const dgy = gLY - y;
        const falloff = Math.exp(-(dgx * dgx + dgy * dgy) / gScaleL2);
        const pull = gatherPull[i] * gAmtGs * falloff;
        x += dgx * pull;
        y += dgy * pull;
      }

      // spotlights: a gaussian brightness pocket around each light. The boosts
      // ADD, so a point sitting in two pockets is lit by both, and the total
      // multiplies whatever the formation's glow hook wrote this frame
      // (compose, never replace); dots outside every pocket sit on base 1.
      // Every drawn index was rewritten above this frame, the dying ones
      // included, so the gain multiplies a fresh base instead of compounding.
      if (litN > 0) {
        let add = 0;
        for (let k = 0; k < litN; k++) {
          const dlx = SPOT_LX[k] - x;
          const dly = SPOT_LY[k] - y;
          const dlz = SPOT_LZ[k] - z;
          add += SPOT_LGAIN[k] * Math.exp(-(dlx * dlx + dly * dly + dlz * dlz) * SPOT_LINV[k]);
        }
        glowBuf[i] = (hasGlow ? glowBuf[i] : 1) * (1 + add);
      }

      // births and deaths ride the ALPHA, multiplied onto whatever the glow
      // hook and the pockets left: a newborn eases up from 0 where it stands,
      // a dying dot eases down where it was caught, and a dot whose life sits
      // at 1 pays one comparison. Only live around a count change (vitaOn).
      if (vitaOn) {
        const tgt = dying ? 0 : 1;
        let v = vita[i];
        if (v !== tgt) {
          v += (tgt - v) * vk;
          if (tgt === 1 ? v > 0.996 : v < 0.004) v = tgt;
          vita[i] = v;
        }
        if (v < 1) {
          glowBuf[i] = (hasGlow || litN > 0 ? glowBuf[i] : 1) * v;
          vitaAny = true;
        } else if (!hasGlow && litN === 0) {
          // a settled life hands its slot back to the resting brightness
          glowBuf[i] = 1;
        }
      }

      positions[i3] = x;
      positions[i3 + 1] = y;
      positions[i3 + 2] = z;
    }
    trailLive.current = trailAny;
    // every drawn life settled (the dying ones drop out of the loop when the
    // draw range clamps on settle), so the per-point work stops for good
    if (vitaOn && !vitaAny) vitaLive.current = false;

    if (geom) {
      const posAttr = geom.getAttribute("position") as THREE.BufferAttribute;
      // upload only the drawn slice, so the per-frame GPU cost stays linear in
      // the drawn count rather than the capacity
      posAttr.clearUpdateRanges();
      posAttr.addUpdateRange(0, n * 3);
      posAttr.needsUpdate = true;
      // push the per-point glow: live while a glowing formation OR the spotlight
      // is up, and reset to all-1 exactly once on the frame after both leave
      // (so plain formations pay nothing). getAttribute may be absent on the
      // plain-material path.
      const glowAttr = geom.getAttribute("aGlow") as THREE.BufferAttribute | undefined;
      if (glowAttr) {
        if (hasGlow || litN > 0 || vitaOn) {
          glowAttr.needsUpdate = true;
          glowActive.current = true;
        } else if (glowActive.current) {
          glowBuf.fill(1);
          glowAttr.needsUpdate = true;
          glowActive.current = false;
        }
      }
    }

    // swaying formations rock gently; everything else faces front. A host
    // orient target layers on top of the sway; the dt-based ease is frame-rate
    // independent, its default rate matches the old 0.06-per-frame feel, and
    // orient.speed dials it from a slow drift (0) to near-instant-but-still-
    // smoothed (1). Eases home the same way when orient goes null.
    if (group) {
      const o = orient ? orient() : null;
      const target = cfg.sway ? Math.sin(t * 0.4) * 0.18 : 0;
      sway.current += (target - sway.current) * easeRate(delta, 2.4);
      // while a morph is in flight the pose rate clamps LOW: without this, a
      // formation switch swings the whole half-built cloud toward (or away
      // from) the pointer, which reads as a glitch on top of the morph
      // speed is a 0..10 dial (5 = the tuned 0.6 internal rate factor);
      // absent, the pose keeps the sway's follow feel
      const rate0 = o?.speed != null ? 0.6 + dial10(o.speed, 0, 0.6, 1) * 29.4 : POSE_RATE;
      const rate = phase.current < morph ? Math.min(rate0, 1.2) : rate0;
      const a = easeRate(delta, rate);
      // the pose eases in its own refs and the DRAG angle is added on top, on
      // both axes: composed, not replaced, so a cloud the user has turned still
      // sways and still leans to an orient target, and an untouched one behaves
      // exactly as it did before dragging existed (both spin refs at 0).
      poseY.current += (sway.current + (o ? o.ry : 0) - poseY.current) * a;
      poseX.current += ((o ? o.rx : 0) - poseX.current) * a;
      group.rotation.y = poseY.current + spin.y;
      group.rotation.x = poseX.current + spin.x;
    }

    // presence eases toward each formation's own opacity and dot size, applied
    // to whichever material is live (plain points, or the shine shader). Both
    // may be viewport functions (e.g. the flower dims/thins as the frame
    // narrows), resolved against the live viewport each frame.
    VP_NOW.w = size.width;
    VP_NOW.h = size.height;
    VP_NOW.ww = viewport.width;
    VP_NOW.wh = viewport.height;
    // the same safe area a build is handed, so a formation that dims itself as
    // the space it has closes in reads one frame, not two. Written field by
    // field rather than through measureVp: this runs every frame, and a frame
    // loop allocates nothing.
    VP_NOW.sw = safeSpan(viewport.width, size.width, insetL + insetR);
    VP_NOW.sh = safeSpan(viewport.height, size.height, insetT + insetB);
    VP_NOW.sx = safeShift(viewport.width, size.width, insetL, insetR);
    VP_NOW.sy = safeShift(viewport.height, size.height, insetB, insetT);
    const rawO = vpValue(cfg.opacity, VP_NOW, 0.3);
    // size is a 0..10 dial (absent = 5, the tuned nominal)
    const rawS = dial10(vpValue(cfg.size, VP_NOW, 5), SIZE_MIN, BASE_SIZE, SIZE_MAX);
    const targetO = rawO * intensity * (additiveOn ? 1 : 0.95);
    curO.current += (targetO - curO.current) * easeRate(delta, 2.4);
    curS.current += (rawS - curS.current) * easeRate(delta, 2.4);
    // the beat rides ON TOP of the eased base (applied after the slow lerp so
    // the pulse stays crisp): a flash of brightness + a hair more size per hit.
    const liveO = curO.current * (1 + b * 0.5);
    const liveS = curS.current * (1 + b * 0.28);
    // the style channels glide at the opacity's own rate (see the curShine
    // block): the loop always writes the EASED values, so a JSX write of the
    // raw prop on a re-render is overwritten before anything is drawn
    // (useFrame runs ahead of the render every frame). Under reduced motion
    // they SNAP, like the morph and the lives do: the loop runs on demand
    // there, and an ease that needs a stream of frames would freeze partway
    // between two looks the moment the frames stop coming.
    const sk = reducedMotion ? 1 : easeRate(delta, 2.4);
    curShine.current += (shine - curShine.current) * sk;
    curRound.current += (round - curRound.current) * sk;
    curAdd.current += (additive - curAdd.current) * sk;
    if (tint !== tintKey.current) {
      tintKey.current = tint;
      tintTarget.set(tint);
    }
    curTint.lerp(tintTarget, sk);
    if (matRef.current) {
      matRef.current.opacity = liveO;
      matRef.current.size = liveS;
      matRef.current.color.copy(curTint);
    }
    if (shaderRef.current) {
      uni.uOpacity.value = liveO;
      uni.uSize.value = liveS;
      uni.uTime.value = t;
      uni.uScale.value = gl.domElement.height * 0.5;
      // synced per frame (not only at creation) so a host can scrub them live
      uni.uShine.value = curShine.current;
      uni.uRound.value = curRound.current;
      uni.uAdditive.value = curAdd.current;
      (uni.uColor.value as THREE.Color).copy(curTint);
      // the blend mode follows the EASED halo, so a host dialling additive to
      // 0 watches the glow fade and the mode flip only once nothing shows it
      const blend = curAdd.current > 0.003 ? THREE.AdditiveBlending : THREE.NormalBlending;
      if (shaderRef.current.blending !== blend) shaderRef.current.blending = blend;
      // the colored pockets are written where they are resolved (the spotlights
      // block above owns this same uniforms object), so nothing about them has
      // to be copied here: untinted, uSpotN stays 0 and the shader never reads
      // the arrays at all.
    }

    // the safe area's CENTER, which is the half of the job a translation can
    // do. The host's inset is css px of ITS OWN CANVAS that are spoken for, so
    // the cloud has to center in what is left rather than in the frame. The px
    // are converted at the z = 0 plane's scale, the plane the engine treats as
    // the cloud's, so a formation sitting well behind it moves a touch less on
    // screen than the number says; one that is laid out in a plane of its own
    // corrects for that in its build, where the depth is known (planeFit in
    // formations.ts). The other half, the SIZE that is left, rides on the
    // viewport a build is handed. Read off the LIVE size, not the debounced
    // dims, so a resize lands with the frame it happens in. Absent, both terms
    // are 0 and the block below is the arithmetic it always was.
    let insetX = 0;
    let insetY = 0;
    if (inset) {
      insetX = safeShift(state.viewport.width, state.size.width, insetL, insetR);
      insetY = safeShift(state.viewport.height, state.size.height, insetB, insetT);
    }

    // parallax: the pointer drifts the whole GROUP, a pure translation with no
    // re-aim, so it reads on flat formations too (a camera lean plus lookAt
    // cancels itself where the depth variance is small). Independent of the
    // cursor mode; eases home when the pointer leaves the stage. Home is the
    // safe area's center, so the lean and the inset COMPOSE: the cloud leans
    // around where it sits rather than around the middle of the canvas. The
    // drag pose composes too, and for free: that is a rotation about the
    // group's own origin, which this moved.
    if (group) {
      const lean = pOn && parallax > 0;
      const lx = lean ? pointer.current.x : 0;
      const ly = lean ? pointer.current.y : 0;
      const homeX = insetX + lx * 0.5 * parallax;
      const homeY = insetY + ly * 0.3 * parallax;
      if (posSeeded.current) {
        const pk = easeRate(delta, 1.8);
        group.position.x += (homeX - group.position.x) * pk;
        group.position.y += (homeY - group.position.y) * pk;
      } else {
        group.position.x = homeX;
        group.position.y = homeY;
        posSeeded.current = true;
      }
    }
  });

  // the per-point material is needed for the twinkle (shine), the glow hook,
  // the light pockets, round corners or the additive halo; with aGlow = 1 and
  // all amounts at 0 it matches the plain material apart from the ~1px analytic
  // edge it adds deliberately (so dots do not twinkle as they drift sub-pixel).
  // An EMPTY spotlights array is no light, so it does not select the shader
  // either: only a callback (which may light something on any frame) or a list
  // with entries in it does.
  const useShader =
    shine > 0 ||
    glow ||
    round > 0 ||
    additive > 0 ||
    typeof spotlights === "function" ||
    (spotlights != null && spotlights.length > 0);
  return (
    <group ref={groupRef}>
      <points>
        <bufferGeometry ref={geomRef}>
          <bufferAttribute attach="attributes-position" args={[positions, 3]} />
          <bufferAttribute attach="attributes-aRand" args={[rands, 1]} />
          <bufferAttribute attach="attributes-aGlow" args={[glowBuf, 1]} />
        </bufferGeometry>
        {useShader ? (
          <shaderMaterial
            ref={shaderRef}
            uniforms={uniforms}
            vertexShader={SHINE_VERT}
            fragmentShader={SHINE_FRAG}
            transparent
            depthWrite={false}
            blending={additiveOn ? THREE.AdditiveBlending : THREE.NormalBlending}
          />
        ) : (
          <pointsMaterial
            ref={matRef}
            size={initialLook.s}
            sizeAttenuation
            transparent
            opacity={initialLook.o}
            color={tint}
            blending={additiveOn ? THREE.AdditiveBlending : THREE.NormalBlending}
            depthWrite={false}
          />
        )}
      </points>
    </group>
  );
}

export interface DsFieldProps {
  formations: Record<string, FieldFormation>;
  formation: string;
  /** any CSS color, applied live and EASED: a tint change glides through RGB
   * at the same rate the opacity does, so recoloring the cloud is a transition
   * rather than a repaint. `shine`, `round` and `additive` ease the same way:
   * every look input lands as motion, never as a step. */
  tint: string;
  /** additive glow dial, 0..10 (default 0 = normal blending, the plain look).
   * Above 0 the blending flips additive and a soft halo dials in (edge falloff
   * plus an overdriven core on the shader path); 5 is the nominal half halo,
   * 10 the full glow. */
  additive?: number;
  /** cursor physics ("off" stops the dot physics only; the pointer drift is
   * `parallax`'s own dial). The field only responds to the pointer while it is
   * over its OWN CANVAS: the pointer is tracked from canvas events, so a
   * pointer over a control panel, a header or any other element stacked on top
   * of the field counts as absent and the cloud eases home exactly as it does
   * when the pointer leaves the window. The same gate gives `parallax` and
   * `trail` their zone. A canvas the host has set to pointer-events none never
   * sees a pointer at all.
   * The influence itself is EASED, never cut: it ramps in as the pointer
   * arrives, relaxes out where the pointer was last seen when it reads absent
   * or the mode flips to "off", and a change between two live modes dips
   * through that same ease before the new physics take over. A displaced
   * cavity therefore releases as motion, not as every dot snapping home in
   * one frame, which is what a pointer crossing onto content stacked over the
   * canvas used to look like. */
  mode?: FieldCursorMode;
  /** per-point shimmer dial, 0..10 (default 0 = no twinkle, NOT the plain
   * material: `round` keeps the shader path lit). 5 is the classic twinkle, 10
   * flickers three times as hard; the tempo is fixed well above the resting
   * breath so shimmer and motion stay independent. */
  shine?: number;
  /** render with the per-point material so a current formation's `glow` hook can
   * light individual dots (opt-in). When nothing glows it matches the plain
   * material apart from the ~1px analytic edge the shader path adds deliberately,
   * so a host can leave it on for the whole session even if only one formation
   * uses it. */
  glow?: boolean;
  /** corner rounding of the dot mark, 0..10: 0 a hard square, 5 the nominal
   * rounded corners, 10 a circle (an SDF on the shader path). Default 10: the
   * fully round dot is the resting mark. */
  round?: number;
  /** cursor-drag trail dial, 0..10 (default 0 = off; 5 is the nominal
   * half-strength wake, 10 the full elastic drag). PHYSICS, not sprites:
   * points the moving cursor sweeps pick up its velocity at their own depth,
   * smear along the path it actually traced, and spring home with damping.
   * Independent of `mode` (works with physics off); inert on floor formations
   * and under reduced motion. Runs on the same canvas-only pointer zone every
   * other cursor effect does (see `mode`): the wake relaxes when the pointer
   * leaves the canvas. */
  trail?: number;
  /** presence dial, 0..10 (default 5 = every formation's own tuned opacity;
   * 0 blacks the cloud out, 10 triples it). Lets a host lift the whole cloud
   * without editing each formation, e.g. over a light background where
   * mid-gray dots read too faint. */
  intensity?: number;
  /** an external 0..1 SIGNAL (not a 0..10 dial), sampled once per frame with
   * the frame delta, that makes the whole cloud tremble + flash in time with
   * it (opt-in). A host can feed it a soundtrack's low-end envelope; the
   * engine stays agnostic about where the number comes from. */
  energy?: (dt: number) => number;
  /** the host's target rect when it's open (else null): the cloud pools a
   * slice of its points behind it and lets them trail when it's dragged.
   * `s` is a 0..10 dial on the pull (5 = the nominal half strength, 10 = the
   * hard drag; omitted = full strength); it's smoothed, so scrubbing a slider
   * glides. `r` (optional) scales the falloff spread and is a raw multiplier,
   * NOT a 0..10 dial: 1.6 reproduces the whole-page default, smaller pools
   * tighter around the target. */
  gather?: () => { x: number; y: number; r?: number; s?: number } | null;
  /** a target pose for the whole cloud in radians (else null), sampled once a
   * frame and eased toward. Rotation happens at the group level so it composes
   * with sway and costs nothing when absent; a host points its 3D shape
   * formations at the cursor with it. `speed` is a 0..10 dial on the ease rate
   * (0 a slow drift, 5 the nominal follow, 10 near-instant but still
   * smoothed); omitted, it matches the sway's follow feel. */
  orient?: () => { rx: number; ry: number; speed?: number } | null;
  /** DRAG TO SPIN, 0..10 (default 5): how the cloud answers a drag on its own
   * canvas. Dragging horizontally turns it around y, vertically around x, the
   * way a hand turns a globe, and letting go leaves it turning with inertia,
   * easing to rest. 5 is the natural feel: the shape follows the pointer about
   * one to one (a drag across the full canvas width is half a turn) and coasts
   * about a second. 10 is loose, twice the travel and a coast several times
   * longer. 0 turns dragging off entirely: no pointerdown handler is attached
   * and the canvas never captures a pointer, so a host stacking its own drag on
   * the canvas gets it uncontested, AND any turn already in the cloud eases back
   * to zero on both axes rather than staying where the hand left it, so a host
   * that drops the dial to 0 for its flat formations gets a field facing the
   * viewer instead of a tilted one. Lowering it to 0 mid drag ends the drag on
   * the spot: the listeners come off, the throw is dropped rather than coasted,
   * and the cloud glides home from wherever it had been turned to. Under reduced
   * motion the turn is given back at once instead of gliding, since the field is
   * static there and the loop runs on demand.
   * The drag angle COMPOSES with `orient` rather than replacing it: the pose
   * eases toward the host's target and the turn the user put in rides on top,
   * so a turned cloud still sways and still leans. Everything that maps world
   * space into the cloud (the `spotlights`, the cursor physics, a floor
   * formation's ground plane, the `trail` wake) comes back through the turn, so
   * the field still answers where the user points however far it has been spun.
   * Under reduced motion dragging still works, but a release stops the cloud
   * where it was let go of instead of coasting. There is no autonomous spin:
   * the cloud only turns when the user turns it. */
  spin?: number;
  /** the SAFE AREA, in css px of the field's own canvas (absent by default):
   * how much of each edge is spoken for by something stacked over the field, a
   * floating card, a header, a side panel. The engine subtracts it from the
   * usable area and centers the cloud in what is LEFT, by shifting the group,
   * so a formation sits in the middle of the space a person actually sees
   * instead of the middle of the canvas, which is what a full bleed canvas
   * under floating content otherwise reads as. Only the DIFFERENCE between
   * opposite edges moves anything: 320 on the left alone shifts the cloud 160
   * px right, 320 on both sides is centered again. It composes with `parallax`
   * (the lean is around the shifted home, not the canvas center) and with the
   * `spin` drag (a rotation about the group's own origin, which this moves),
   * lands whole on the first frame rather than gliding in, and follows a resize
   * on the frame it happens. The px are converted at the z = 0 plane, the plane
   * formations are laid out in, so a formation sitting well behind it shifts a
   * touch less on screen than the number says. Absent, it costs one branch a
   * frame. */
  inset?: FieldInset;
  /** morph duration dial, 0..10 (default 5 = the tuned 1.15 seconds): how long
   * the cloud takes to travel between formations. 0 is the slowest useful
   * crawl (6 seconds), 10 is nearly instant (0.12). The per-point stagger is a
   * FRACTION of the duration, so it scales with the dial and a fast morph still
   * arrives point by point. Moving the dial mid-morph is safe: what stays fixed
   * is the fraction travelled, so the cloud carries on from where it is instead
   * of snapping. */
  transition?: number;
  /** up to four positionable light pockets: points near each given world
   * position (the same space as gather's payload, mapped through the group's
   * current pose each frame, so they hold their world spot under parallax,
   * orient, the drag turn and fit) brighten through the per-point glow path, a
   * gaussian falloff with no hard edge. Per pocket: `intensity` 0..10 (5 lifts
   * the center to 2.5x brightness, 10 to 6x until the point's alpha saturates
   * at 1, near dial 6.4 at the default opacity; default 5), `radius` 0..10 (0.2
   * world units at 0, 1.1 at 5, 3 at 10; default 5), `z` defaults 0.
   * The pockets COMPOSE: the boosts add, so a point sitting in two of them is
   * lit by both, and the tints mix in list order, so it takes color from both.
   * Entry k keeps its own smoothing, so a stable list order means each light
   * eases where it stands; extras past four are ignored, and an empty array,
   * a null entry and an absent prop are all simply no light, at no cost.
   * Pass a callback to re-aim them per frame (resolved once a frame, like
   * gather); dropping a pocket (null, a shorter list, a null return) eases it
   * out, the same presence ease gather gets. Composes with a formation's own
   * glow hook by MULTIPLICATION. `tint` (a CSS color, absent by default) makes
   * a pocket colored light: points in it also lean from the field's `tint`
   * toward that color by the same gaussian, so the light reads as light rather
   * than as a recolored region. */
  spotlights?: FieldSpotlight[] | (() => (FieldSpotlight | null)[] | null);
  /** buffer headroom in points. Formations may then build DIFFERENT lengths (up
   * to this cap): the field draws each target's own length, and a count change
   * is births and deaths, never a reshuffle: grown dots fade in at their own
   * places and shrunk dots fade out where they stand, so a host's count knob
   * glides instead of remounting the canvas or sending a third of the cloud
   * flying. The fades ride the per-point alpha, so they need the shader path
   * (`round` above 0, the default, already selects it); on the plain material
   * a count change lands in place without the fade.
   * Omitted, capacity = the first build's length (the fixed-N contract). */
  capacity?: number;
  /** pointer-following drift of the whole cloud, 0..10 (default 5 = the tuned
   * lean; 0 off, 10 half again as far): a pure translation of the group, no
   * re-aim, so it reads on flat formations too. Eases home when the pointer
   * leaves the canvas (see `mode` for the zone). Independent of `mode`: a host
   * can keep the drift with the dot physics off. */
  parallax?: number;
  /** morph transit scatter dial, 0..10 (default 0): how far each point wanders
   * off the straight line while the cloud travels between formations. 0 is that
   * straight line, every dot moving directly from where it was to where it is
   * going, and it costs nothing. 5 detours the typical point about 0.9 world
   * units at mid-transit, a clearly scattered crossing on a frame around 12
   * units wide; 10 detours it about 2.4, a wide swirl. The detour is drawn from
   * the point's own index, so a morph scatters the same way every time it runs,
   * and it rides a bump envelope that is exactly zero at both endpoints: however
   * wide the swirl, every dot still lands exactly on its target. A point whose
   * start and end coincide (what a count change leaves behind) stays still
   * rather than shivering. */
  shuffle?: number;
  /** mobile point budget, 0..10 (default 10): below 768 css px of canvas
   * width the drawn point count scales by mobile/10 (0 draws nothing on
   * phones, 10 the full count; a plain fraction, not a dial10 curve). The
   * trimmed field DECIMATES the build with a stride, so it thins across the
   * whole shape instead of losing its tail. Applied where the target count
   * resolves, so the change morphs like any count change, and recomputed on
   * the engine's debounced resize. */
  mobile?: number;
}

export function DsField({
  formations,
  formation,
  tint,
  additive = 0,
  mode = "repel",
  shine = 0,
  glow = false,
  round = 10,
  trail = 0,
  intensity = 5,
  energy,
  gather,
  orient,
  spin = 5,
  inset,
  transition = 5,
  spotlights,
  capacity,
  parallax = 5,
  shuffle = 0,
  mobile = 10,
}: DsFieldProps) {
  // pause the render loop when the tab is hidden: a backgrounded canvas should
  // not keep re-uploading the point buffer and drawing at 60fps. r3f resumes
  // cleanly when "always" is restored on the next visibilitychange.
  const [frameloop, setFrameloop] = useState<"always" | "never" | "demand">("always");
  const [reducedMotion, setReducedMotion] = useState(false);
  // touch devices render at dpr 1: the per-frame point upload is the cost, and
  // a phone GPU compositing 1.75x pixels on top of it is the bounce-risk case
  const [dpr, setDpr] = useState<[number, number]>([1, 1.75]);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const coarse = window.matchMedia("(pointer: coarse)");
    // hidden tab -> never; reduced-motion -> demand (render only on a formation
    // change, so an idle reduced-motion field does zero work); else the live loop.
    const sync = () => {
      setReducedMotion(mq.matches);
      setFrameloop(document.hidden ? "never" : mq.matches ? "demand" : "always");
      setDpr(coarse.matches ? [1, 1] : [1, 1.75]);
    };
    sync();
    document.addEventListener("visibilitychange", sync);
    mq.addEventListener("change", sync);
    coarse.addEventListener("change", sync);
    return () => {
      document.removeEventListener("visibilitychange", sync);
      mq.removeEventListener("change", sync);
      coarse.removeEventListener("change", sync);
    };
  }, []);
  return (
    <Canvas
      frameloop={frameloop}
      // fallback: WebGL unavailable (blocked, headless, ancient GPU) renders
      // nothing instead of throwing from a layout effect with no boundary
      fallback={null}
      dpr={dpr}
      camera={{ position: [0, 0, FIELD_CAMERA.z], fov: FIELD_CAMERA.fov }}
      gl={{ antialias: false, alpha: true, powerPreference: "high-performance" }}
    >
      {/* the public 0..10 dials map to internal tuned units HERE, at the
          boundary, through the one shared helper; the core beyond this line
          speaks internal units only */}
      <Cloud
        formations={formations}
        formation={formation}
        tint={tint}
        additive={dial10(additive, 0, 0.5, 1)}
        mode={mode}
        shine={dial10(shine, 0, 1, 3)}
        glow={glow}
        round={dial10(round, 0, 0.5, 1)}
        intensity={dial10(intensity, 0, 1, 3)}
        energy={energy}
        gather={gather}
        orient={orient}
        spinGain={dial10(spin, 0, DRAG_GAIN_NOMINAL, DRAG_GAIN_MAX)}
        spinDamp={dial10(spin, DRAG_DAMP_MIN, DRAG_DAMP_NOMINAL, DRAG_DAMP_MAX)}
        spotlights={spotlights}
        inset={inset}
        morph={dial10(transition, MORPH_SLOW, MORPH_NOMINAL, MORPH_FAST)}
        capacity={capacity}
        trail={dial10(trail, 0, 0.5, 1)}
        parallax={dial10(parallax, 0, 1, 1.5)}
        shuffle={dial10(shuffle, 0, SHUFFLE_NOMINAL, SHUFFLE_MAX)}
        // a plain fraction rather than a dial curve, but the NaN defence is the
        // same one dial10 runs, and here it guards the buffer itself: a NaN
        // budget makes the target count NaN, and a NaN in the positions never
        // washes out, since the engine reads them back as the next morph's start
        mobile={Number.isFinite(mobile) ? Math.min(10, Math.max(0, mobile)) / 10 : 1}
        reducedMotion={reducedMotion}
      />
    </Canvas>
  );
}
