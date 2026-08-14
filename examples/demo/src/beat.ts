/* The analyser tap. One AudioContext for the whole demo, one graph, and a
 * per-frame read of what is actually coming out of it:
 *
 *   sources -> bus -> analyser -> master -> destination
 *
 * Every source (the synthesized patterns, the bundled tracks, an uploaded
 * file) connects to `bus`, so the envelope below is derived from whatever is
 * playing without any source needing to know it is being measured.
 *
 * The analyser sits BEFORE the master gain on purpose. It measures the mix at
 * unit gain, so the visuals keep reacting the same way at any listening
 * volume. Turning the volume down quiets the room, it does not flatten the
 * cloud.
 *
 * Two numbers come out, both 0..1:
 *   beat  - the low band transient. Snaps on a kick, glides back between.
 *   level - overall loudness. A slow, broad reading for anything that should
 *           follow the track's intensity rather than its pulse.
 *
 * Browser only, and lazy: the context is created on the first play (a user
 * gesture), never at import. Autoplay policy also starts every context
 * suspended, so callers resume on the same gesture that starts playback.
 * Ported from the 0switch lab's beat.ts, which drives the same envelope. */

type WebkitWindow = Window & { webkitAudioContext?: typeof AudioContext };

export type AudioGraph = { ctx: AudioContext; bus: GainNode };

let ctx: AudioContext | null = null;
let bus: GainNode | null = null;
let analyser: AnalyserNode | null = null;
let master: GainNode | null = null;
// backed by an explicit ArrayBuffer so it types as Uint8Array<ArrayBuffer>,
// which is what getByteFrequencyData wants (TS 5.7+ DOM lib).
let freq: Uint8Array<ArrayBuffer> | null = null;
let volume = 0.5;

let beat = 0; // smoothed low band envelope, 0..1
let level = 0; // smoothed broadband loudness, 0..1

/* adaptive loudness window. The low band of a mastered track sits pinned near
 * the top, so an absolute level reads as "always loud" with no beat. Track a
 * slow floor (recent quiet) and ceiling (recent loud) and normalize the
 * instant level into that window, so the full 0..1 swing is used and the kick
 * pattern shows through whatever the track's overall loudness. */
let floor = 0;
let ceil = 0.15;
// the adaptive ceiling never drops below this, so a quiet low band cannot be
// auto-gained back up to "loud" (keeps quiet passages quiet).
const CEIL_MIN = 0.22;
// the absolute low band RMS that counts as fully loud, which gates the effect
// by real volume. Lower means the field reacts at lower volumes.
const LOUD_REF = 0.6;
// the absolute broadband RMS that counts as fully loud. Higher than LOUD_REF
// would suggest is wrong: the byte FFT is a dB mapping, and the upper bins of
// real music sit far below the low end.
const LEVEL_REF = 0.55;
// low band bins for the kick: 1..8 is roughly 43..344 Hz at fftSize 1024.
// Bin 0 is the DC offset and is skipped.
const LO = 1;
const HI = 8;
// broadband bins. Above ~11 kHz there is almost nothing to weigh, and
// including it would only drag every reading down.
const BROAD_HI = 255;

/* The shared graph, created on demand. Returns null where Web Audio is
 * missing, in which case sources still play and the envelope stays at 0. */
export function audioGraph(): AudioGraph | null {
  if (typeof window === "undefined") return null;
  if (ctx && bus) return { ctx, bus };
  const AC = window.AudioContext ?? (window as WebkitWindow).webkitAudioContext;
  if (!AC) return null;
  try {
    ctx = new AC();
    bus = ctx.createGain();
    analyser = ctx.createAnalyser();
    // 1024 gives 512 bins at ~43 Hz each: fine enough to isolate the kick and
    // bass band, and only lightly smoothed so transients are not smeared away.
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.4;
    freq = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));
    master = ctx.createGain();
    master.gain.value = volume;
    bus.connect(analyser);
    analyser.connect(master);
    master.connect(ctx.destination);
    return { ctx, bus };
  } catch {
    // a policy or resource error must never break the page. No graph means no
    // sound and a flat envelope, nothing worse.
    ctx = null;
    bus = null;
    analyser = null;
    return null;
  }
}

/* Resume the context. Browsers only allow this from (or just after) a user
 * gesture, so callers invoke it on the same click or keypress that plays. */
export function resumeAudio(): void {
  if (ctx && ctx.state === "suspended") void ctx.resume();
}

/* Master volume, 0..1. Ramped rather than set, so a slider drag does not
 * click. Remembered even when called before the graph exists. */
export function setMasterVolume(v: number): void {
  volume = v < 0 ? 0 : v > 1 ? 1 : v;
  if (master && ctx) master.gain.setTargetAtTime(volume, ctx.currentTime, 0.03);
}

// a MediaElementAudioSourceNode can be created only ONCE per element, ever.
// Re-creating throws, so cache per element and make attaching idempotent.
const sources = new WeakMap<HTMLMediaElement, MediaElementAudioSourceNode>();

/* Route an <audio> element into the bus. Idempotent per element, and it must
 * precede play: once routed, the element's sound only reaches the speakers
 * through the (resumed) context. */
export function attachElement(el: HTMLAudioElement): void {
  const g = audioGraph();
  if (!g) return;
  if (sources.has(el)) return;
  try {
    const src = g.ctx.createMediaElementSource(el);
    sources.set(el, src);
    src.connect(g.bus);
  } catch {
    // a duplicate source error must never break playback; if the tap fails the
    // envelope simply stays at 0.
  }
}

/* Advance both envelopes by one frame. Call ONCE per frame with the frame
 * delta in seconds; read the results with beatValue / levelValue. Cheap: one
 * FFT copy and one pass over the bins. */
export function sampleEnvelope(dt: number): void {
  if (!analyser || !freq) {
    beat = 0;
    level = 0;
    return;
  }
  analyser.getByteFrequencyData(freq);

  let lowSq = 0;
  let broadSq = 0;
  for (let k = LO; k <= BROAD_HI; k++) {
    const v = freq[k] / 255;
    const sq = v * v;
    broadSq += sq;
    if (k <= HI) lowSq += sq;
  }
  const inst = Math.sqrt(lowSq / (HI - LO + 1)); // low band RMS, 0..1
  const broad = Math.sqrt(broadSq / (BROAD_HI - LO + 1)); // broadband RMS, 0..1

  const d = Math.min(dt, 0.05); // clamp so a stalled tab cannot lurch the smoothers

  // adaptive window. The ceiling chases peaks (fast up, slow down) but never
  // sinks below CEIL_MIN, and the floor chases quiets, so a loud section does
  // not saturate yet a quiet one is not auto-gained back up to full.
  ceil += (inst - ceil) * (inst > ceil ? 1 - Math.exp(-d / 0.06) : 1 - Math.exp(-d / 2.5));
  if (ceil < CEIL_MIN) ceil = CEIL_MIN;
  floor += (inst - floor) * (inst < floor ? 1 - Math.exp(-d / 0.25) : 1 - Math.exp(-d / 1.8));

  // pulse: the transient ABOVE the local baseline, which is what makes a kick
  // read even when the low end is otherwise steady.
  let pulse = (inst - floor) / Math.max(0.05, ceil - floor);
  pulse = pulse < 0 ? 0 : pulse > 1 ? 1 : pulse;
  // loudness: the absolute level, so a quiet passage stays quiet instead of
  // being normalized back up. LOUD_REF maps a fully loud low band to 1.
  const loud = Math.min(1, inst / LOUD_REF);
  // a beat needs BOTH a transient AND real volume: a steady low end barely
  // moves it, a loud hit drives it hard.
  const raw = pulse * loud;

  // follower: attack (~60ms) snaps toward a hit, release (~200ms) glides back.
  const kb = raw > beat ? 1 - Math.exp(-d / 0.06) : 1 - Math.exp(-d / 0.2);
  beat += (raw - beat) * kb;

  // the broad reading answers "how much is going on", so it is deliberately
  // lazier than the beat: slow enough that it never flickers on a single hit.
  const rawLevel = Math.min(1, broad / LEVEL_REF);
  const kl = rawLevel > level ? 1 - Math.exp(-d / 0.12) : 1 - Math.exp(-d / 0.45);
  level += (rawLevel - level) * kl;
}

/* The last sampled low band envelope, 0..1. */
export function beatValue(): number {
  return beat;
}

/* The last sampled broadband loudness, 0..1. */
export function levelValue(): number {
  return level;
}
