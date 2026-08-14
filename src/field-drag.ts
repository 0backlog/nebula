/* Drag to spin: the turn a hand puts into the cloud, and the way it comes
 * home. The engine advances this once a frame, ahead of everything that maps
 * world space into the cloud, so a throw's angle is the frame's angle. Pure
 * arithmetic over a small state object, no three.js and no React. */

import { easeRate, POSE_RATE } from "./field-units.js";

export const TAU = Math.PI * 2;

// the spin dial's two halves. GAIN is how far a drag turns the cloud, in
// radians per NDC unit of pointer travel: the canvas is 2 NDC units across, so
// dial 5 (π/2) turns half a turn on a drag across the full width, which is the
// shape following the hand about one to one, and dial 10 (π) turns a whole one.
// DAMP is how fast the throw dies, in e-folds a second: dial 5 (3.2) is down to
// 4% after a second, dial 10 (0.7) is still half up after one and coasts for
// several. Dial 0 has no gain at all, which is what turns dragging off.
export const DRAG_GAIN_NOMINAL = Math.PI / 2;
export const DRAG_GAIN_MAX = Math.PI;
export const DRAG_DAMP_MIN = 6;
export const DRAG_DAMP_NOMINAL = 3.2;
export const DRAG_DAMP_MAX = 0.7;
// a flick is clamped to this many radians a second (about two turns) so a
// violent throw across three pixels of a small canvas cannot blur the cloud,
// and parked below this the spin is snapped to a hard stop so an idle field
// does no work
export const DRAG_SPEED_MAX = 12;
export const DRAG_SPEED_STOP = 0.004;
// and the way HOME, for when the dial says dragging is off: the accumulated
// drag angle eases to zero at POSE_RATE, the rate every other pose move runs
// at, and snaps to exactly zero under this many radians, a thousandth of one,
// so an idle field does no work and a flat formation ends up exactly facing
// the viewer.
export const DRAG_HOME_STOP = 1e-3;

/* one step of a drag angle's way home, `k` of the remaining turn. The angle is
 * folded to the SHORTEST equivalent turn first (the accumulators are kept
 * within a full turn, so one fold does it): a cloud left at 6 radians is a
 * cloud left a fifth of a radian short of home, and it must come back that way
 * rather than unwinding the long way round. The fold is the same pose, so
 * nothing jumps. Under DRAG_HOME_STOP the remainder is snapped away, which is
 * what makes "facing the viewer" exact and lets the block stop running. */
export function homeAngle(a: number, k: number) {
  const v = a > Math.PI ? a - TAU : a < -Math.PI ? a + TAU : a;
  const n = v - v * k;
  return Math.abs(n) < DRAG_HOME_STOP ? 0 : n;
}

/** the angle the drag has put in, on y (horizontal drag) and x (vertical),
 * wrapped to one turn so it never grows unbounded, plus the angular velocity
 * a released drag coasts on */
export interface SpinState {
  y: number;
  x: number;
  vy: number;
  vx: number;
}

export function createSpin(): SpinState {
  return { y: 0, x: 0, vy: 0, vx: 0 };
}

/* THE TURN, advanced one frame. Held down, the cloud follows the hand: the
 * travel the listeners banked since the last frame turns it (horizontal around
 * y, vertical around x, the way a hand turns a globe), and the same travel
 * feeds an eased velocity, so one stalled frame cannot decide the throw.
 * Released, that velocity is what it coasts on, dying at the dial's own rate.
 * Both angles wrap at a full turn so the accumulators never grow unbounded;
 * the wrap is the same pose, and the pose ease never sees it because the pose
 * eases its own refs. And with the gain at 0 the angle EASES HOME rather than
 * sitting where it was left (the second branch says why).
 * `d` is the pointer hook's drag accumulator: the banked travel is consumed
 * here (dx/dy zeroed as they are taken), so the turn is measured in the frame
 * it is applied and no event is dropped between frames. */
export function advanceSpin(
  s: SpinState,
  d: { down: boolean; dx: number; dy: number },
  spinGain: number,
  spinDamp: number,
  delta: number,
  reducedMotion: boolean | undefined,
): void {
  if (spinGain > 0) {
    if (d.down) {
      const ax = d.dx * spinGain;
      // screen-down is NDC-down, and a hand pulling down rolls the near face
      // of the cloud down with it, which is a POSITIVE turn around x
      const ay = -d.dy * spinGain;
      d.dx = 0;
      d.dy = 0;
      s.y += ax;
      s.x += ay;
      const idt = 1 / Math.max(delta, 1e-4);
      const vr = easeRate(delta, 18);
      s.vy += (ax * idt - s.vy) * vr;
      s.vx += (ay * idt - s.vx) * vr;
      const sp = Math.hypot(s.vx, s.vy);
      if (sp > DRAG_SPEED_MAX) {
        const c = DRAG_SPEED_MAX / sp;
        s.vx *= c;
        s.vy *= c;
      }
    } else if (s.vx !== 0 || s.vy !== 0) {
      // reduced motion still drags (the hand is driving, that is not motion
      // the engine invented) but never coasts: the cloud stops where it was
      // let go of.
      if (reducedMotion) {
        s.vx = 0;
        s.vy = 0;
      } else {
        s.y += s.vy * delta;
        s.x += s.vx * delta;
        const damp = Math.exp(-delta * spinDamp);
        s.vy *= damp;
        s.vx *= damp;
        if (Math.abs(s.vy) < DRAG_SPEED_STOP) s.vy = 0;
        if (Math.abs(s.vx) < DRAG_SPEED_STOP) s.vx = 0;
      }
    }
    s.y %= TAU;
    s.x %= TAU;
  } else if (s.y !== 0 || s.x !== 0 || s.vy !== 0 || s.vx !== 0) {
    // DRAGGING IS OFF, so the turn a hand put in COMES HOME. The gain going
    // to 0 used to mean "stop reading the drag", which froze the cloud at
    // whatever angle it was last left at: pick a flat formation (a host
    // passes spin 0 on those) after turning a shape and the curtain rendered
    // as a tilted plane instead of facing the viewer. Off is not frozen. The
    // accumulated angle eases to zero on BOTH axes at the pose ease's own
    // rate, so a flat field always ends up facing the viewer, and a shape the
    // user turns and comes back to unwinds instead of snapping. Any throw is
    // dropped rather than coasted: dragging is off, so there is nothing left
    // to carry, only a pose to give back.
    s.vy = 0;
    s.vx = 0;
    if (reducedMotion) {
      // there, the field is static and the loop runs on DEMAND: an ease would
      // get one frame and park the cloud half turned, so the pose is simply
      // given back, the same call reduced motion makes on the morph.
      s.y = 0;
      s.x = 0;
    } else {
      const k = easeRate(delta, POSE_RATE);
      s.y = homeAngle(s.y, k);
      s.x = homeAngle(s.x, k);
    }
  }
}
