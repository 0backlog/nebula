/* The frame and the safe area: how the engine measures its own canvas, and how
 * it answers a host whose floating cards have spoken for part of it. Pure
 * arithmetic over numbers, no three.js and no React: the engine calls all of
 * this from its frame loop, so nothing in here allocates. */

/** the field's own canvas, in both units a build may need: `w`/`h` are css px,
 * `ww`/`wh` the world units the same rectangle spans at the z = 0 plane.
 *
 * The `s` four are the SAFE AREA as a rectangle, the space a person can
 * actually see once the host's floating cards are taken off the canvas (see
 * DsField.inset): `sw`/`sh` its size and `sx`/`sy` its middle, all in world
 * units at the same z = 0 plane, the middle measured from the canvas's own. A
 * host that declares no inset gets `ww`/`wh` and 0, 0, and every formation
 * behaves exactly as it would have without any of this.
 *
 * A field that is MEANT to bleed off the canvas edges reads `ww`/`wh` and
 * ignores the rest. A formation that is laid out rather than scattered reads
 * the safe size, because no amount of centering makes an object wider than the
 * gap between two cards fit between them. `sx`/`sy` is the one to be careful
 * with: the engine has ALREADY moved the whole cloud there, so a build that
 * lays out around its own origin is centered on it and must not add it again.
 * It is published for the one thing that move cannot get right on its own, a
 * formation laid out at a depth of its own, where a world translation measured
 * at z = 0 lands short on screen (see planeFit in formations.ts). */
export interface FieldViewport {
  w: number;
  h: number;
  ww: number;
  wh: number;
  sw: number;
  sh: number;
  sx: number;
  sy: number;
}

/** the SAFE AREA, in css px of the field's own canvas: how much of each edge is
 * spoken for by something else (a floating card, a header, a panel). The engine
 * subtracts it from the usable area and centers the cloud in what is left, by
 * shifting the group, so a formation sits in the middle of the space a person
 * actually sees rather than in the middle of the canvas. All four default to 0,
 * which is the plain centered cloud and costs nothing. */
export interface FieldInset {
  left?: number;
  right?: number;
  top?: number;
  bottom?: number;
}

// one edge of the safe area, in css px. A non-finite entry (a host binding a
// cleared number input) reads as no inset rather than as a NaN: the group's
// position is EASED toward the shift and never re-seeded, so one NaN frame
// would park the cloud off screen for good.
export function insetPx(v: number | undefined) {
  return v != null && Number.isFinite(v) ? v : 0;
}

/* THE SAFE AREA, one axis at a time, in world units at the z = 0 plane. It is a
 * rectangle and it takes two numbers to say so: how much of the frame is left,
 * and where the middle of what is left has moved to. The engine spends the
 * second on the group's position and hands both to every build, because a
 * translation is only half an answer: no position makes an object that is wider
 * than the gap between two floating cards fit between them.
 *
 * Both are given a canvas that has not been measured yet, which reports 0 css
 * px: dividing by it would write a NaN into a position, and a NaN in the buffer
 * never washes out, since the engine reads the live positions back as the start
 * of the next morph. The span answers the frame itself there, and cards that
 * between them cover the whole canvas get the same answer, because a formation
 * at the size it was tuned at is a better failure than one collapsed to a dot.
 * Neither allocates, so the frame loop calls them too. */
export function safeSpan(world: number, px: number, lost: number): number {
  if (!(px > 0) || !(world > 0)) return world;
  const span = world - lost * (world / px);
  return span > 0 ? span : world;
}

/* `near` and `far` are the two edges in the order the axis counts: left then
 * right across, and BOTTOM then top down the frame, since css y counts down and
 * world y counts up, so a top inset pushes the cloud DOWN. Only the DIFFERENCE
 * moves anything: a 320 px left inset alone moves the middle 160 px right, and
 * 320 on both sides is still the middle. */
export function safeShift(world: number, px: number, near: number, far: number): number {
  if (!(px > 0) || !(world > 0)) return 0;
  return ((near - far) / 2) * (world / px);
}

/* Two frames that say the same thing. A settle that lands on the frame the
 * engine already holds is not a change, and keeping the object it already holds
 * is what stops the targets rebuilding into the very numbers they were built
 * from: the first debounce after a mount is exactly that case. */
export function sameVp(a: FieldViewport, b: FieldViewport): boolean {
  return (
    a.w === b.w &&
    a.h === b.h &&
    a.ww === b.ww &&
    a.wh === b.wh &&
    a.sw === b.sw &&
    a.sh === b.sh &&
    a.sx === b.sx &&
    a.sy === b.sy
  );
}

/* The frame a build is handed, measured once and spelled once, so the viewport
 * the engine mounts with, the one it rebuilds on and the one it resolves a
 * formation's live opacity against can never come to describe it differently. */
export function measureVp(
  w: number,
  h: number,
  ww: number,
  wh: number,
  left: number,
  right: number,
  top: number,
  bottom: number
): FieldViewport {
  return {
    w,
    h,
    ww,
    wh,
    sw: safeSpan(ww, w, left + right),
    sh: safeSpan(wh, h, top + bottom),
    sx: safeShift(ww, w, left, right),
    sy: safeShift(wh, h, bottom, top),
  };
}

/* a formation field that is either a plain number or a function of the frame
 * (`opacity` and `size` both are), resolved against the viewport it is being
 * drawn at. The mount seeds the material through this and the frame loop eases
 * toward it through the same call, so the two can never read a formation
 * differently. Returns a number rather than a look object: the loop runs it
 * every frame, and a frame loop allocates nothing. */
export function vpValue(
  v: number | ((vp: FieldViewport) => number) | undefined,
  vp: FieldViewport,
  fallback: number,
): number {
  return typeof v === "function" ? v(vp) : v ?? fallback;
}
