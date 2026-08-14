/* field-face-drive: the talking face's voice input, one module for the whole
 * app. Two ways in, one way out:
 *
 *   1. attachFaceAudio(el) routes an <audio>/<video> element through an analyser
 *      and derives the mouth from two frequency bands.
 *   2. setFaceDrive({ open, spread }) pushes amplitude straight in, no element
 *      and no analyser. THIS IS THE VOICE-AGENT INTEGRATION POINT: a TTS stream
 *      calls it as chunks arrive, at whatever rate it has data, and the face
 *      follows. An external push wins for EXTERNAL_HOLD seconds and then decays
 *      back to the analyser (or to silence), so a dropped stream closes the
 *      mouth instead of freezing it open.
 *
 * sampleFaceDrive(dt) is the single read, called once per frame from the point
 * loop. One AudioContext, one AnalyserNode, sources cached per element,
 * everything wrapped so a missing Web Audio implementation or an autoplay
 * rejection leaves the face idle rather than breaking the canvas.
 *
 * The drive is about VOICE only. Idle life (the micro-open between utterances,
 * the blink) belongs to the formation, so an agent-driven face still breathes
 * without the agent sending anything. */

import { dial10 } from "./field.js";

type WebkitWindow = Window & { webkitAudioContext?: typeof AudioContext };

export type FaceDrive = {
  /** jaw aperture, 0 closed .. 1 wide */
  open: number;
  /** lip corner spread, 0 neutral .. 1 wide (the i and e stretch) */
  spread: number;
  /** lip rounding, 0 neutral .. 1 pursed (the o and u pucker) */
  round: number;
};

let ctx: AudioContext | null = null;
let analyser: AnalyserNode | null = null;
// backed by an explicit ArrayBuffer so it types as Uint8Array<ArrayBuffer>,
// which is what getByteFrequencyData wants (TS 5.7+ DOM lib)
let freq: Uint8Array<ArrayBuffer> | null = null;

// a MediaElementAudioSourceNode can be created only ONCE per element, ever, so
// a remount must not try again
const sources = new WeakMap<HTMLMediaElement, MediaElementAudioSourceNode>();

/* bands, at fftSize 1024 (about 43 Hz per bin). Rough formant reading:
 * F1 sits low for closed vowels (i, u) and high for open ones (a); F2 sits
 * high for front vowels (i, e) and collapses for rounded back ones (o, u).
 * Splitting the voiced range around those centers is enough to SHAPE the
 * mouth per vowel class, not just open it. Sibilance stays its own band. */
const F1LO_LO = 6; // about 250 Hz, closed-vowel first formant
const F1LO_HI = 11;
const F1HI_LO = 12; // about 500 Hz to 1 kHz, open-vowel first formant
const F1HI_HI = 23;
const F2_LO = 24; // about 1 kHz to 2.5 kHz, front-vowel second formant
const F2_HI = 58;
const SIB_LO = 59; // about 2.5 kHz to 5 kHz, sibilance and fricatives
const SIB_HI = 116;

// speech level swings far more than a mastered track's low end, so each band
// normalizes into an adaptive window (fast-up slow-down ceiling with a floor
// minimum, slow floor). An absolute threshold reads as either always-open or
// never-open.
const CEIL_MIN = 0.1;
// below this fraction of the normalized level, room noise must not mumble
const GATE = 0.06;
// how long an external push outranks the analyser before it decays away
const EXTERNAL_HOLD = 0.35;

type Band = { ceil: number; floor: number; env: number };
// named after the INPUT bands they track: voiced energy and sibilance
const bVoiced: Band = { ceil: CEIL_MIN, floor: 0, env: 0 };
const bSib: Band = { ceil: CEIL_MIN, floor: 0, env: 0 };
// the shaped outputs get a plain attack/release smoother (NOT the adaptive
// window: they are already built from normalized levels, and renormalizing
// them would stretch weak shaping to full)
const sm = { open: 0, spread: 0, round: 0 };

let gain = 1;
/* the mouth's three channels, named once: every push, clear and read below
 * walks this list instead of spelling the same three lines out again. */
const CHANNELS = ["open", "spread", "round"] as const;
const external: FaceDrive = { open: 0, spread: 0, round: 0 };
// which channels a host has actually pushed. A channel nobody pushed keeps
// following the analyser rather than being held at 0 by a partial push.
const pushed = { open: false, spread: false, round: false };
let externalAge = Infinity;

// a shared mutable result: this is read at 60 Hz inside the point loop, so it
// must not allocate
const out: FaceDrive = { open: 0, spread: 0, round: 0 };

/* Route an element into the face analyser. Idempotent per element, safe before
 * any user gesture (the context starts suspended). */
export function attachFaceAudio(el: HTMLMediaElement): void {
  if (typeof window === "undefined") return;
  const AC = window.AudioContext ?? (window as WebkitWindow).webkitAudioContext;
  if (!AC) return; // no Web Audio means no lip sync; playback still works
  try {
    if (!ctx) ctx = new AC();
    if (!analyser) {
      analyser = ctx.createAnalyser();
      // 1024 gives 512 bins at about 43 Hz, fine enough to split voiced energy
      // from sibilance, and lightly smoothed so syllables stay legible
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.3;
      freq = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));
      analyser.connect(ctx.destination);
    }
    if (!sources.has(el)) {
      const src = ctx.createMediaElementSource(el);
      sources.set(el, src);
      src.connect(analyser);
    }
  } catch {
    // a duplicate source or a policy error must never break the page; the face
    // simply stays idle
  }
}

/* Resume the context. Browsers only allow this from a user gesture, so call it
 * on the same click that starts playback. */
export function resumeFaceAudio(): void {
  if (ctx && ctx.state === "suspended") void ctx.resume();
}

/* THE VOICE-AGENT INTEGRATION POINT. Push amplitude straight in. Values clamp
 * to 0..1. Partial: push { open } alone and spread keeps following whatever it
 * was following. */
export function setFaceDrive(patch: Partial<FaceDrive>): void {
  for (const k of CHANNELS) {
    const v = patch[k];
    if (typeof v === "number" && Number.isFinite(v)) {
      external[k] = v < 0 ? 0 : v > 1 ? 1 : v;
      pushed[k] = true;
    }
  }
  // the hold restarts on the CALL, not on a channel moving: a stream that sends
  // `open` alone with every chunk keeps the spread and round it pushed earlier
  // alive too, instead of letting them decay back to the analyser mid-word.
  externalAge = 0;
}

/* Drop the external push immediately (end of utterance). */
export function clearFaceDrive(): void {
  for (const k of CHANNELS) {
    external[k] = 0;
    pushed[k] = false;
  }
  externalAge = Infinity;
}

/* Sensitivity on the analyser path, a 0..10 dial (default 5 = the tuned
 * nominal; 0 mutes the shaping, 10 triples it): scales the SHAPED mouth
 * outputs (open, spread, round) before their smoothing, so it survives the
 * adaptive level normalization and acts as a real dial. setFaceDrive values
 * are absolute and are not scaled by it. */
export function setFaceDriveGain(g: number): void {
  gain = Number.isFinite(g) ? dial10(g, 0, 1, 3) : 1;
}

/* THE MOUTH GESTURE'S TUNED NOMINAL, in the internal units field-face
 * multiplies its landmark travels by: what `jaw` and `lips` are worth at dial
 * 5, and what they are worth to a host that never touches them.
 *
 * 0.4 of the travels field-face-asset publishes, not all of them. Those are
 * full-range figures, MOUTH_TRAVEL being a jaw at its widest drop, and a
 * sentence does not spend its time at the widest of anything: driven at the
 * whole travel the face chews rather than speaks, and the useful part of the
 * dial was all below 5. 0.4 is where it was actually being run. The ceiling
 * stays DOUBLE the nominal, the relationship the dial shipped with, so 10 is
 * still the loudest this face gets and every step under it reads.
 *
 * Only the mouth pair is on this scale. `blink` is a rate multiplier rather
 * than a travel, its own tuning, and untouched by any of it. */
const MOUTH_GESTURE_NOMINAL = 0.4;
const MOUTH_GESTURE_MAX = MOUTH_GESTURE_NOMINAL * 2;

/* Per-channel gesture dials, applied by the formation (field-face.ts) on top
 * of its tuned travels: jaw scales the mandible drop, lips the corner spread,
 * blink multiplies the blink RATE (0 stops blinking, higher blinks more often;
 * the lid ramps keep their tuned durations). All three are 0..10 dials where
 * 5 is the tuned nominal; jaw and lips top out at DOUBLE the nominal travel and
 * blink at triple the nominal rate (internal 0..3). The rest here IS the
 * nominal, so a host that never calls setFaceGesture gets the face dial 5
 * describes rather than a hotter one. They live HERE rather than in field-face
 * so a host page can set them without importing the three-heavy formation
 * module. */
const gesture = {
  jaw: MOUTH_GESTURE_NOMINAL,
  lips: MOUTH_GESTURE_NOMINAL,
  blink: 1,
};

export function setFaceGesture(patch: { jaw?: number; lips?: number; blink?: number }): void {
  // dials map to internal units on the way IN; the engine reads internal only
  if (typeof patch.jaw === "number" && Number.isFinite(patch.jaw)) {
    gesture.jaw = dial10(patch.jaw, 0, MOUTH_GESTURE_NOMINAL, MOUTH_GESTURE_MAX);
  }
  if (typeof patch.lips === "number" && Number.isFinite(patch.lips)) {
    gesture.lips = dial10(patch.lips, 0, MOUTH_GESTURE_NOMINAL, MOUTH_GESTURE_MAX);
  }
  if (typeof patch.blink === "number" && Number.isFinite(patch.blink)) {
    gesture.blink = dial10(patch.blink, 0, 1, 3);
  }
}

/** read by field-face's per-frame advance; returns the shared object, in
 *  INTERNAL units (the mouth pair's dial 5 is 0.4 of the asset's travel, and
 *  blink's is 1), not the 0..10 dial */
export function faceGesture(): { jaw: number; lips: number; blink: number } {
  return gesture;
}

/** plain attack/release follower toward a target already in 0..1 */
function smooth(env: number, target: number, d: number, attack: number, release: number): number {
  const t = target < 0 ? 0 : target > 1 ? 1 : target;
  const k = t > env ? 1 - Math.exp(-d / attack) : 1 - Math.exp(-d / release);
  return env + (t - env) * k;
}

function bandRms(lo: number, hi: number): number {
  const f = freq!;
  let sq = 0;
  for (let k = lo; k <= hi; k++) {
    const v = f[k] / 255;
    sq += v * v;
  }
  return Math.sqrt(sq / (hi - lo + 1));
}

/* Normalize an instant level into the band's adaptive window, gate it, then
 * run an attack/release follower so it reads as speech and not flicker. Attack
 * and release are per band: consonants are shorter than the shape they imply,
 * so spread holds a touch longer than open. */
function follow(b: Band, inst: number, d: number, attack: number, release: number): number {
  b.ceil += (inst - b.ceil) * (inst > b.ceil ? 1 - Math.exp(-d / 0.08) : 1 - Math.exp(-d / 1.6));
  if (b.ceil < CEIL_MIN) b.ceil = CEIL_MIN;
  b.floor +=
    (inst - b.floor) * (inst < b.floor ? 1 - Math.exp(-d / 0.3) : 1 - Math.exp(-d / 1.4));
  let lvl = (inst - b.floor) / Math.max(0.05, b.ceil - b.floor);
  if (lvl < GATE) lvl = 0;
  const raw = lvl < 0 ? 0 : lvl > 1 ? 1 : lvl;
  const k = raw > b.env ? 1 - Math.exp(-d / attack) : 1 - Math.exp(-d / release);
  b.env += (raw - b.env) * k;
  return b.env;
}

/* Sample ONCE per frame with the frame delta in seconds. Returns a shared
 * object, not a fresh allocation: zero on every channel when nothing is wired
 * up and nothing is being pushed. */
export function sampleFaceDrive(dt: number): FaceDrive {
  // clamp so a stalled or backgrounded tab cannot lurch the smoothers
  const d = Math.min(Math.max(dt, 0), 0.05);
  externalAge += d;

  if (analyser && freq) {
    analyser.getByteFrequencyData(freq);
    const eF1lo = bandRms(F1LO_LO, F1LO_HI);
    const eF1hi = bandRms(F1HI_LO, F1HI_HI);
    const eF2 = bandRms(F2_LO, F2_HI);
    const eSib = bandRms(SIB_LO, SIB_HI);
    const voiced = eF1lo + eF1hi;
    const vsum = voiced + eF2 + 1e-6;

    // vowel shaping as energy RATIOS, so it survives the level normalization:
    // openness pushes the jaw further on open vowels, frontness stretches the
    // corners (i, e), backness rounds them (o, u). Front and back compete for
    // the same lips, so each suppresses the other.
    const openness = eF1hi / (voiced + 1e-6);
    const front = eF2 / vsum;
    const back = (voiced - eF2 * 1.4) / vsum;

    // 35 ms attack is fast enough for a 4 to 7 Hz syllable rate, 90 ms release
    // slow enough that the jaw reads as speech. Only the raw LEVELS run the
    // adaptive window; the shaped products below get plain smoothing.
    const lvlV = follow(bVoiced, voiced, d, 0.035, 0.09);
    const sib = follow(bSib, eSib, d, 0.05, 0.14);

    const openRaw = lvlV * (0.55 + 0.45 * Math.min(1, openness * 1.8));
    const spreadRaw = Math.max(sib * 0.9, lvlV * Math.min(1, front * 2.2));
    let roundRaw = lvlV * Math.max(0, Math.min(1, back * 2.6)) * (1 - front);
    // one mouth: a wide stretch and a pucker cannot both win a frame
    roundRaw *= 1 - spreadRaw * 0.75;

    // the gain lands on the SHAPED outputs (smooth clamps its target to 0..1),
    // where it acts as real sensitivity rather than being washed out by the
    // adaptive window upstream
    sm.open = smooth(sm.open, openRaw * gain, d, 0.035, 0.09);
    sm.spread = smooth(sm.spread, spreadRaw * (1 - roundRaw * 0.5) * gain, d, 0.05, 0.14);
    sm.round = smooth(sm.round, roundRaw * gain, d, 0.06, 0.16);
  }

  // an external push outranks the analyser while it is fresh, then crossfades
  // back over the hold window so a dropped stream closes rather than freezes
  const hold = externalAge < EXTERNAL_HOLD ? 1 - externalAge / EXTERNAL_HOLD : 0;
  for (const k of CHANNELS) {
    out[k] = pushed[k] ? external[k] * hold + sm[k] * (1 - hold) : sm[k];
  }
  return out;
}
