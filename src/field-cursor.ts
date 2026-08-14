/* The cursor physics: what the pointer does to the dots. The shapes of the
 * three modes (repel's cavity, attract's pull, vortex's swirl), the rims where
 * each one ends, and the eased presence that keeps any of it from snapping.
 * The engine's per-point loop applies these; this file owns what they are.
 * Pure arithmetic, no three.js and no React. */

import { easeRate } from "./field-units.js";

// "off" turns off the dot physics; the pointer parallax is its own dial
export type FieldCursorMode = "repel" | "attract" | "vortex" | "off";

/* the CURSOR'S OWN presence: how fast the mode physics fade in when the
 * pointer arrives over the canvas and fade out when it reads absent. The zone
 * is decided by the browser's hit testing, and a pointer crossing ONTO a
 * floating card flips it in one event with the cavity fully open under it:
 * stateless physics released in one frame read as every displaced dot snapping
 * home at once, which is exactly what people saw whenever they reached for the
 * panel. Faster than the pockets' presence, because the cursor is the one
 * effect that tracks the hand and a slow fade reads as a ghost of it. */
export const CURSOR_EASE_PRESENCE = 6;
// the presence under which a mode change ADOPTS the new physics. Two stateless
// fields cannot crossfade on one scalar, so a live-to-live mode flip dips the
// force out through the physics it was wearing and rises back wearing the new
// ones; below this the leftover displacement is a few percent of a dot's
// travel, which is what makes the adoption itself invisible.
export const CURSOR_SWAP_BELOW = 0.1;

// THE CURSOR'S RIM, per mode: where a mode's influence ends, as a multiple of
// the reach `cursorReach` sets, SQUARED. The loop carries a point's distance
// over the reach already squared (d2), so these compare against it directly and
// nothing takes a root to find the edge. The numbers are the gates the modes
// have always had, so the reach dial reaches exactly as far as it used to.
export const CURSOR_RIM2_REPEL = 2.6;
export const CURSOR_RIM2_ATTRACT = 4.2;
export const CURSOR_RIM2_VORTEX = 3.6;
// and how fast each mode falls off near the cursor: the gaussian rate that
// gives it its feel, also unchanged.
export const CURSOR_GAUSS_REPEL = 1.6;
export const CURSOR_GAUSS_ATTRACT = 0.45;
export const CURSOR_GAUSS_VORTEX = 0.55;
// how hard the two INWARD-BOUND modes act, as the share of its own distance
// from the cursor a point gives up in a frame, not as a distance in world
// units. See the note over cursorPull for why that distinction is the whole
// difference between a pull and a pile.
export const CURSOR_PULL_ATTRACT = 0.3;
export const CURSOR_SWIRL_VORTEX = 0.42;
// and the ceiling on that share, which is what the top of the force dial is
// worth. A share of s packs the dots right under the cursor to 1/(1 - s)² of
// the density they had, so 0.75 is a core four times tighter each way and 16
// times brighter: a hard knot, which is what force 10 should look like, and
// short of the white dot a share near 1 would make. It doubles as the guard
// that keeps any future retuning under 1, the share at which every point
// inside the reach lands on the cursor at once.
export const CURSOR_PULL_MAX = 0.75;
// repel is the outward mode, so it pushes by a DISTANCE rather than a share
// (a cavity means moving the dots that sit exactly under the cursor, and a
// share of nothing is nothing): this is that push, in world units at full
// falloff, before the force dial and the presence scale it.
export const CURSOR_PUSH_REPEL = 0.34;

/* THE CURSOR'S FALLOFF: what share of a mode's force a point takes at `d2`, its
 * distance from the cursor over the reach, squared. Two factors multiplied.
 *
 * The gaussian is the FEEL near the cursor, each mode's own rate, the one it was
 * tuned with. On its own it is still worth about 1.6% of full force out at
 * repel's rim, and a gate that drops that to nothing in a pixel is a ring the
 * eye catches, which is exactly what people saw.
 *
 * The quartic window is what makes the rim invisible. With t = d2 / rim2, which
 * is the distance over the rim radius squared, the window is (1 - t)²: 1 at the
 * cursor, exactly 0 AT the rim, and FLAT at both ends. Flat at the middle is
 * what keeps the force under the pointer feeling like the old one; zero value
 * AND zero slope at the rim is what leaves nothing to see, where a linear taper
 * would still crease. The influence is a function of distance alone, so it is
 * radial in every direction.
 *
 * Callers gate on d2 < rim2, so t < 1 in here and the window never goes
 * negative. Arithmetic over numbers the loop already holds: no allocation, no
 * root of its own (the direction's is the loop's, unchanged), and a divide and
 * two multiplies more than the hard cut it replaces. */
export function cursorFalloff(d2: number, rim2: number, gauss: number): number {
  const w = 1 - d2 / rim2;
  return Math.exp(-d2 * gauss) * w * w;
}

/* ATTRACT'S PULL and VORTEX'S SWIRL, as the SHARE of a point's own distance
 * from the cursor that the mode moves it, which is what keeps either one from
 * folding the cloud over itself.
 *
 * Repel can push by a distance in world units, because the thing it makes is a
 * cavity: every point near the cursor leaves, the middle empties, and the
 * further out a point starts the less it moves, so the map outward is strictly
 * increasing and no two points ever meet. An inward mode with the same shape is
 * a different animal. A push of 0.25 world units applied to a point 0.3 from
 * the cursor lands it at 0.05, and applied to a point 0.05 away it throws it
 * out the far side; the ring of points whose distance equals the push lands
 * exactly ON the cursor. Whatever guard keeps the middle still then has the
 * incoming points arriving inside it, so the settled dots and the pulled ones
 * sit in the same annulus at once, two copies of the cloud, with a hard edge
 * where the second one begins. That reads exactly like points appearing out of
 * nowhere, because that is what it is.
 *
 * Scaling by the distance removes the possibility rather than guarding against
 * it. A point at distance d closes k(d) of it and ends at d(1 - k): the pull
 * vanishes at the cursor instead of overshooting it, the order of the points
 * along the radius is preserved, and, since k comes from cursorFalloff, it is
 * still exactly 0 at the rim. The share is capped below 1, which is the only
 * value that could still collapse the field.
 *
 * There is no divide here either, and no root: the caller multiplies the offset
 * itself, which is already the direction times the distance. The old form
 * needed the length to normalize by, and needed a floor under it so a point
 * sitting on the cursor did not divide by zero. */
export function cursorPull(d2: number, cf: number): number {
  const k = cursorFalloff(d2, CURSOR_RIM2_ATTRACT, CURSOR_GAUSS_ATTRACT) * CURSOR_PULL_ATTRACT * cf;
  return k < CURSOR_PULL_MAX ? k : CURSOR_PULL_MAX;
}

export function cursorSwirl(d2: number, cf: number): number {
  const k = cursorFalloff(d2, CURSOR_RIM2_VORTEX, CURSOR_GAUSS_VORTEX) * CURSOR_SWIRL_VORTEX * cf;
  return k < CURSOR_PULL_MAX ? k : CURSOR_PULL_MAX;
}

/* THE CURSOR'S PRESENCE, stepped once a frame. The mode physics are stateless,
 * so anything that flips their gate in one frame (the pointer crossing onto a
 * card stacked over the canvas, the host switching mode to "off") used to
 * release every displaced dot at once: a whole open cavity snapping home,
 * right as the hand reaches for a control. The force scales by this eased
 * presence instead: it ramps in as the pointer arrives and relaxes out after
 * it reads absent, running on the pointer's LAST position (the coords go
 * stale, never blank), and the fade-out keeps the last real mode, since "off"
 * no longer says which physics to fade through. Saturated at 1 it multiplies
 * by exactly 1, so a resting hover is the tuned physics untouched.
 * A change between two LIVE modes goes through the same dip: the new physics
 * are adopted only once the old ones have faded under CURSOR_SWAP_BELOW, so a
 * clump pulled in by attract relaxes out before repel starts pushing, instead
 * of flipping sign in one frame. "off" simply never re-arms the rise, so the
 * same dip is the whole fade-out. */
export interface CursorPresence {
  /** the eased presence, 0..1: the force multiplier */
  amt: number;
  /** the physics on screen: the last LIVE mode, which the fade-out keeps */
  mode: Exclude<FieldCursorMode, "off">;
}

export function createCursorPresence(): CursorPresence {
  return { amt: 0, mode: "repel" };
}

export function cursorPresence(
  c: CursorPresence,
  mode: FieldCursorMode,
  pOn: boolean,
  delta: number,
): void {
  const modeNow = mode === "off" ? null : mode;
  if (modeNow != null && (modeNow === c.mode || c.amt < CURSOR_SWAP_BELOW)) {
    c.mode = modeNow;
  }
  // presence rises only while the physics on screen are the ones asked for
  c.amt += ((pOn && modeNow === c.mode ? 1 : 0) - c.amt) * easeRate(delta, CURSOR_EASE_PRESENCE);
  if (c.amt < 0.003) c.amt = 0;
}
