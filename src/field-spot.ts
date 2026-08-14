/* The light pockets: up to four positionable spotlights that brighten (and
 * may tint) the points around a world-space position. This file owns the
 * pocket state and the once-a-frame resolve; the engine's per-point loop only
 * reads the packed arrays it leaves behind. The eases are the shared ones the
 * gather attractor runs on (field-units), because the two have to read as one
 * behavior. */

import * as THREE from "three";
import { dial10, easeRate, EASE_AIM, EASE_STRENGTH, EASE_PRESENCE } from "./field-units.js";
import { SPOT_MAX } from "./field-shader.js";

/** one of the host's light pockets: a world-space position (the same space as
 * gather's payload) that brightens the points around it. `intensity` and
 * `radius` are 0..10 dials: intensity 5 lifts the center to a 2.5x brightness
 * (10 reaches 6x, 0 turns it off), radius 5 is a 1.1 world-unit gaussian
 * falloff (0.2 at 0, 3 at 10). z defaults to 0.
 * Up to four of these ride at once (see DsField.spotlights) and they COMPOSE:
 * the brightness boosts add, so a point sitting in two pockets is lit by both,
 * and the tints mix in list order, so it also takes color from both.
 * The position is WORLD space whatever pose the cloud is in: the engine maps
 * it through the group's current transform (the parallax drift, the sway and
 * orient rotation, the layout fit) every frame, so the pocket stays on the
 * spot the host aimed at while the cloud leans, turns and scales under it.
 * The gain multiplies the point's ALPHA, and alpha saturates at 1, so the
 * ratio only holds while `formation opacity * presence * gain` stays under
 * it. At the defaults (opacity 0.3, presence 5) that lands near dial 6.4:
 * past it the center is already solid and the dial only widens the lit pool.
 * A dimmer formation or a lower `intensity` buys the top of the dial back.
 * `tint` makes it COLORED light: absent, the pocket only brightens, which is
 * the original behavior to the pixel. */
export interface FieldSpotlight {
  x: number;
  y: number;
  z?: number;
  intensity?: number;
  radius?: number;
  /** a CSS color for the light itself. Absent (the default) the pocket only
   *  brightens, exactly as it always has. Set, a point inside the pocket also
   *  shifts from the field's `tint` toward this one by the SAME gaussian weight
   *  that drives its brightness: full at the center, nothing at the edge, so
   *  the pocket reads as colored light falling on the cloud rather than as a
   *  recolored region with a border. It rides the shader's own copy of that
   *  gaussian, so a tint costs no extra per-point work on the cpu and no extra
   *  buffer traffic, and it works the same under additive and normal blending
   *  (additive adds colored light, normal paints it). Fades in and out on the
   *  same presence ease the pocket itself gets, so setting or clearing it mid
   *  flight glides. `intensity` 0 with a tint set is legal and useful: a pocket
   *  that colors without brightening. */
  tint?: string;
}

/** the prop as DsField accepts it: a list, a callback that re-aims one per
 * frame, or nothing at all */
export type FieldSpotlights = FieldSpotlight[] | (() => (FieldSpotlight | null)[] | null);

// the frame's PACKED brightening pockets: the ones that actually light
// something, in group-local units, so the per-point loop walks a short array
// instead of testing four slots. Written by resolveSpotlights, read by the
// engine's loop within the same frame (write-then-read, so instances sharing
// the module scratch cannot race).
export const SPOT_LX = new Float32Array(SPOT_MAX);
export const SPOT_LY = new Float32Array(SPOT_MAX);
export const SPOT_LZ = new Float32Array(SPOT_MAX);
export const SPOT_LINV = new Float32Array(SPOT_MAX);
export const SPOT_LGAIN = new Float32Array(SPOT_MAX);

// scratch for parsing a pocket's css tint into linear rgb (the same conversion
// the field's own color gets), read straight out into the per-slot cache
const COL = new THREE.Color();
// scratch for mapping a pocket's world position into group-local space, on the
// same write-then-read-within-one-frame terms as the packed arrays above
const P_LOCAL = new THREE.Vector3();

/** one slot per pocket. The position, the boost AND the radius SMOOTH toward
 * what the host asks for, and a presence amount eases the whole pocket in and
 * out when its entry flips null/non-null, the treatment gather gets. SLOT k IS
 * ENTRY k of the host's list: a light keeps its own smoothing as long as the
 * list keeps its order, and a list that reorders reads as each slot easing
 * toward its new job.
 * `tintRgb` holds the parsed tint, `tintKey` the string it was parsed from,
 * so a live color only reparses when it actually moves. `any` is whether any
 * pocket still holds presence, so the ease-out keeps running for the frames
 * after the host drops the prop and stops for good after that: with no pockets
 * at all the whole resolve is skipped, one branch a frame, zero per-point
 * work. */
export interface SpotSlots {
  x: Float32Array;
  y: Float32Array;
  z: Float32Array;
  amt: Float32Array;
  boost: Float32Array;
  r: Float32Array;
  tintAmt: Float32Array;
  tintRgb: Float32Array;
  tintKey: (string | null)[];
  any: boolean;
}

export function createSpotSlots(): SpotSlots {
  return {
    x: new Float32Array(SPOT_MAX),
    y: new Float32Array(SPOT_MAX),
    z: new Float32Array(SPOT_MAX),
    amt: new Float32Array(SPOT_MAX),
    boost: new Float32Array(SPOT_MAX),
    r: new Float32Array(SPOT_MAX).fill(1.1),
    tintAmt: new Float32Array(SPOT_MAX),
    tintRgb: new Float32Array(SPOT_MAX * 3),
    tintKey: new Array<string | null>(SPOT_MAX).fill(null),
    any: false,
  };
}

/* the host's light pockets, resolved once per frame (the callback form re-aims
 * them live, like gather). Each slot's position and boost smooth the way the
 * gather attractor does; presence eases a pocket in/out on its own
 * null/non-null flip. They brighten through the same aGlow path the
 * formation's glow hook writes, so pockets and hook COMPOSE: the boosts ADD
 * into one gain (a point in two pockets is lit by both) and that gain
 * multiplies whatever the hook wrote.
 * The group transform arrives as its pieces (the translation, the inverse
 * rotation, the uniform fit), because a pocket's position is world space and
 * has to come back into the cloud's own frame here, once, rather than per
 * point. Returns how many pockets actually brighten this frame: the packed
 * arrays above hold those, and the engine's loop walks exactly that many.
 * The whole resolve, ease-out included, is skipped once nothing is lit and
 * nothing is easing out: an absent prop costs one branch a frame. */
export function resolveSpotlights(
  slots: SpotSlots,
  spotlights: FieldSpotlights | undefined,
  uni: Record<string, THREE.IUniform>,
  delta: number,
  gpx: number,
  gpy: number,
  gpz: number,
  ginv: THREE.Quaternion,
  fit: number,
): number {
  const spotsNow =
    spotlights == null ? null : typeof spotlights === "function" ? spotlights() : spotlights;
  // how many pockets brighten (packed into the module scratch, read per
  // point) and how many tint (packed into the uniform arrays, read per vertex)
  let litN = 0;
  let tintN = 0;
  // an EMPTY list is as absent as no prop at all: nothing to ease in, and the
  // ease-out only has to run while a pocket still holds presence
  if ((spotsNow != null && spotsNow.length > 0) || slots.any) {
    const eAim = easeRate(delta, EASE_AIM);
    const eBoost = easeRate(delta, EASE_STRENGTH);
    const ePresence = easeRate(delta, EASE_PRESENCE);
    const uSpot = uni.uSpot.value as Float32Array;
    const uTint = uni.uTint.value as Float32Array;
    const uTintAmt = uni.uTintAmt.value as Float32Array;
    const uSpotInv = uni.uSpotInv.value as Float32Array;
    let any = false;
    for (let k = 0; k < SPOT_MAX; k++) {
      // extras past SPOT_MAX are ignored, and a null entry is simply no light
      // in that slot: it eases out where it stands
      const s = spotsNow != null && k < spotsNow.length ? spotsNow[k] ?? null : null;
      if (s) {
        slots.x[k] += (s.x - slots.x[k]) * eAim;
        slots.y[k] += (s.y - slots.y[k]) * eAim;
        slots.z[k] += ((s.z ?? 0) - slots.z[k]) * eAim;
        // intensity 0..10: the internal unit is the ADDED peak gain (0 / 1.5 /
        // 5), so the center brightness runs 1x (off) / 2.5x (nominal) / 6x
        // (max), up to the shader's alpha ceiling: uOpacity * aGlow clamps at
        // 1, which at the default 0.285 resting opacity is reached around
        // dial 6.4
        slots.boost[k] += (dial10(s.intensity ?? 5, 0, 1.5, 5) - slots.boost[k]) * eBoost;
        // radius 0..10 -> the gaussian falloff radius in world units,
        // smoothed like the boost so a scrubbed dial swells the pool
        // instead of stepping its edge
        slots.r[k] += (dial10(s.radius ?? 5, 0.2, 1.1, 3) - slots.r[k]) * eBoost;
      }
      // the tint is a color, so it cannot be smoothed toward "absent": what
      // eases is how far the mix travels. Same rate as the pocket's own
      // presence, so a tint appearing, changing or clearing glides.
      const tintNow = s?.tint ?? null;
      slots.tintAmt[k] += ((tintNow != null ? 1 : 0) - slots.tintAmt[k]) * ePresence;
      slots.amt[k] += ((s ? 1 : 0) - slots.amt[k]) * ePresence;
      // reparsed only when the host's color actually moves, and never while
      // the tint is fading out (there is no color to read then), so a pocket
      // on its way out fades in the color it was lit with
      if (tintNow != null && tintNow !== slots.tintKey[k]) {
        slots.tintKey[k] = tintNow;
        COL.set(tintNow);
        slots.tintRgb[k * 3] = COL.r;
        slots.tintRgb[k * 3 + 1] = COL.g;
        slots.tintRgb[k * 3 + 2] = COL.b;
      }
      if (slots.amt[k] <= 0.003) continue;
      any = true;
      // the pocket position is world space (gather's space): map it back
      // through the group's WHOLE transform (the parallax drift, the
      // sway/orient/drag rotation, the layout fit) so the light stays on the
      // world spot the host aimed at while the cloud leans, turns and scales
      // under it. The radius is world units too; the group scale is uniform,
      // so the pocket stays a sphere once mapped in.
      P_LOCAL.set(slots.x[k] - gpx, slots.y[k] - gpy, slots.z[k] - gpz)
        .applyQuaternion(ginv)
        .divideScalar(fit);
      const rl = slots.r[k] / fit;
      const inv = 1 / (2 * rl * rl);
      const gain = slots.boost[k] * slots.amt[k];
      if (gain > 0.001) {
        SPOT_LX[litN] = P_LOCAL.x;
        SPOT_LY[litN] = P_LOCAL.y;
        SPOT_LZ[litN] = P_LOCAL.z;
        SPOT_LINV[litN] = inv;
        SPOT_LGAIN[litN] = gain;
        litN++;
      }
      const ta = slots.tintAmt[k] * slots.amt[k];
      if (ta > 0.001) {
        // the shader gets the SAME group-local center and falloff, so its copy
        // of the gaussian is the same gaussian the boost above ran
        uSpot[tintN * 3] = P_LOCAL.x;
        uSpot[tintN * 3 + 1] = P_LOCAL.y;
        uSpot[tintN * 3 + 2] = P_LOCAL.z;
        uSpotInv[tintN] = inv;
        uTint[tintN * 3] = slots.tintRgb[k * 3];
        uTint[tintN * 3 + 1] = slots.tintRgb[k * 3 + 1];
        uTint[tintN * 3 + 2] = slots.tintRgb[k * 3 + 2];
        uTintAmt[tintN] = ta;
        tintN++;
      }
    }
    slots.any = any;
    // the COUNT is the gate the shader's loop breaks on, and it is a scalar:
    // it has to be written on the material's own holder or the loop reads 0
    // for good and every point keeps the field's flat color (the tint packed
    // above would then never be sampled at all).
    uni.uSpotN.value = tintN;
  }
  return litN;
}
