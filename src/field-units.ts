/* The shared units: the dial, the hash, and the eases. Everything the engine
 * measures, it measures with these, and they live in one file so any module
 * taken on its own still speaks the same units the core does. */

/* dial10: THE mapping between a public 0..10 dial and its internal tuned
 * units. 5 is always the nominal tuned value; 0..5 spans min..nominal and
 * 5..10 spans nominal..max, piecewise linear. Input clamps to 0..10, and a
 * NaN dial (a host binding a cleared number input) resolves to the nominal:
 * the frame loop eases into refs that are never re-seeded, so one NaN frame
 * would stick for good. Every dial in the public API resolves through this
 * one helper. */
export function dial10(v: number, min: number, nominal: number, max: number): number {
  const d = v < 0 ? 0 : v > 10 ? 10 : Number.isFinite(v) ? v : 5;
  return d <= 5 ? min + (d / 5) * (nominal - min) : nominal + ((d - 5) / 5) * (max - nominal);
}

// the engine's one deterministic per-point random: a pure function of the
// index, so the same field scatters, staggers and shimmers the same way on
// every mount, and a formation's own tables can line up with the engine's
export function fieldHash01(i: number) {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

// dt-correct per-frame ease: the fraction of the remaining distance covered in
// `delta` seconds. Rates are tuned to match the old 60fps per-frame lerps.
export function easeRate(delta: number, rate: number) {
  return 1 - Math.exp(-delta * rate);
}

// THE POSE EASE, in e-folds a second: the rate the layout fit, a speed-less
// orient target and the way home from a drag all close on their target at. One
// number, because to the eye the three are one motion.
export const POSE_RATE = 3.7;

// the three rates a POSITIONED EFFECT smooths on: how fast it follows where the
// host aims it, how fast it takes a new strength, and how fast it fades in or
// out when the host adds or drops it. The gather attractor and the light
// pockets both run on these, because the two have to read as one behavior, and
// the aim's lag is what makes a pool trail a dragged target.
export const EASE_AIM = 10.4;
export const EASE_STRENGTH = 6.3;
export const EASE_PRESENCE = 4.3;
