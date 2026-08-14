/* The demo's soundtrack: one API over three kinds of source, one signal out.
 *
 * WHAT THIS IS FOR
 * The engine only ever asks the host for a 0..1 number per frame. Where that
 * number comes from is the host's problem, and this file is a real answer to
 * it: whatever is playing goes through a Web Audio analyser, and the demo
 * reads a genuine envelope off it rather than a synthetic clock.
 *
 * SOURCES (SOUNDTRACK_SOURCES, in menu order)
 *   kind "synth"  three deterministic patterns synthesized in the browser at a
 *                 known bpm. Zero assets, so the reactive path works with no
 *                 audio files at all.
 *   kind "track"  the five bundled mp3s. Free with attribution: rendering the
 *                 credit is not optional, see <Credits /> in credits.tsx.
 *   kind "upload" whatever file the user picks. Same graph, same signal.
 *
 * USAGE
 *   import { SOUNDTRACK_SOURCES, playSource, stopSource, setVolume,
 *            loadUpload, sampleAudio, UPLOAD_ID } from "./soundtrack";
 *
 *   playSource("cyberpunk");        // from a click. Resumes the context.
 *   setVolume(0.5);                 // 0..1, master, applies to every source.
 *   loadUpload(file);               // then playSource(UPLOAD_ID)
 *   stopSource();
 *
 *   // once per frame, then route the numbers wherever they are wanted
 *   const { beat, level, playing } = sampleAudio(dt);
 *
 * THE SIGNAL
 *   beat   0..1 low band transient. Snaps on a kick, glides back between.
 *   level  0..1 broadband loudness. Slow, follows intensity not pulse.
 *   playing  whether sound is actually coming out right now, which is not the
 *            same as "a source was requested": autoplay policy can refuse.
 *
 * GESTURE RULE
 * Browsers start every AudioContext suspended and refuse playback until the
 * user has interacted. playSource resumes on the caller's gesture, and if the
 * browser still refuses it arms the next pointer or key event to try again.
 * So call playSource from a real event handler, not from a mount effect.
 *
 * The analyser and the graph live in beat.ts, ported from the 0switch lab. */

import {
  attachElement,
  audioGraph,
  beatValue,
  levelValue,
  resumeAudio,
  sampleEnvelope,
  setMasterVolume,
} from "./beat";

export type SourceKind = "synth" | "track" | "upload";

export type SourceId =
  | "pulse"
  | "drive"
  | "rush"
  | "shotgun"
  | "cyberpunk"
  | "suspense"
  | "carbon-veins"
  | "homo-digital"
  | "upload";

/* Attribution for a bundled track. NCS and Pixabay both license these free of
 * charge on the condition that the artist and the source are credited with a
 * working link, so every "track" source carries one and the UI shows it. */
export type SoundtrackCredit = { by: string; via: string; url: string };

export type SoundtrackSource = {
  id: SourceId;
  kind: SourceKind;
  /* menu label. For the upload source this is a placeholder until a file is
   * loaded; use uploadName() to show the real filename. */
  label: string;
  /* synth only: the pattern's tempo, exact by construction. */
  bpm?: number;
  /* track only: required attribution. */
  credit?: SoundtrackCredit;
};

export const UPLOAD_ID: SourceId = "upload";

// public/ is served from the site root, and BASE_URL keeps that true if the
// demo is ever hosted under a subpath.
const asset = (name: string) => `${import.meta.env.BASE_URL}${name}`;

export const SOUNDTRACK_SOURCES: readonly SoundtrackSource[] = [
  { id: "pulse", kind: "synth", label: "Pulse · 96", bpm: 96 },
  { id: "drive", kind: "synth", label: "Drive · 124", bpm: 124 },
  { id: "rush", kind: "synth", label: "Rush · 145", bpm: 145 },
  {
    id: "shotgun",
    kind: "track",
    label: "Shotgun",
    credit: { by: "Pat", via: "NCS", url: "http://ncs.io/shotgun" },
  },
  {
    id: "cyberpunk",
    kind: "track",
    label: "Cyberpunk",
    credit: { by: "Max Brhon", via: "NCS", url: "http://ncs.io/Cyberpunk" },
  },
  {
    id: "suspense",
    kind: "track",
    label: "Suspense",
    credit: {
      by: "prettyjohn1",
      via: "Pixabay",
      url: "https://pixabay.com/users/prettyjohn1-54616349/?utm_source=link-attribution&utm_medium=referral&utm_campaign=music&utm_content=517449",
    },
  },
  {
    id: "carbon-veins",
    kind: "track",
    label: "Carbon Veins",
    credit: {
      by: "Tony",
      via: "Pixabay",
      url: "https://pixabay.com/users/slimeyfox-6041778/?utm_source=link-attribution&utm_medium=referral&utm_campaign=music&utm_content=480982",
    },
  },
  {
    id: "homo-digital",
    kind: "track",
    label: "Homo Digital",
    credit: {
      by: "Rockot",
      via: "Pixabay",
      url: "https://pixabay.com/users/rockot-1947599/?utm_source=link-attribution&utm_medium=referral&utm_campaign=music&utm_content=245041",
    },
  },
  { id: UPLOAD_ID, kind: "upload", label: "Your file" },
];

// the mp3 behind each "track" source, kept out of the descriptor so the list
// above stays about what the UI needs.
const TRACK_FILES: Partial<Record<SourceId, string>> = {
  shotgun: asset("soundtrack-shotgun.mp3"),
  cyberpunk: asset("soundtrack-cyberpunk.mp3"),
  suspense: asset("soundtrack-suspense.mp3"),
  "carbon-veins": asset("soundtrack-carbon-veins.mp3"),
  "homo-digital": asset("soundtrack-homo-digital.mp3"),
};

/* Look a source up by id. Returns undefined for an unknown id rather than
 * throwing: an id can come from a URL or from restored state. */
export function sourceById(id: SourceId | string | null | undefined): SoundtrackSource | undefined {
  if (!id) return undefined;
  return SOUNDTRACK_SOURCES.find((s) => s.id === id);
}

/* ---------------------------------------------------------------- synthesis
 * Three patterns, each a kick (sine drop), an offbeat hat (filtered noise) and
 * a low pad, scheduled with a lookahead timer. They exist so the whole
 * reactive path is demonstrable with no audio assets, and they go through the
 * same analyser as everything else, so nothing downstream can tell them apart
 * from a file. */

const LOOKAHEAD_S = 0.12;
const TICK_MS = 30;

let noiseBuf: AudioBuffer | null = null;
let synthGain: GainNode | null = null;
let timer: number | null = null;
let nextBeat = 0;
let beatLen = 0;
let beatIndex = 0;

/* one second of deterministic pseudo noise for the hats: a tiny LCG instead of
 * Math.random, so two runs sound identical */
function noise(c: AudioContext) {
  if (noiseBuf) return noiseBuf;
  const buf = c.createBuffer(1, c.sampleRate, c.sampleRate);
  const data = buf.getChannelData(0);
  let s = 22222;
  for (let i = 0; i < data.length; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    data[i] = (s / 0x3fffffff - 1) * 0.6;
  }
  noiseBuf = buf;
  return buf;
}

function kick(c: AudioContext, out: GainNode, t: number) {
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.frequency.setValueAtTime(150, t);
  osc.frequency.exponentialRampToValueAtTime(48, t + 0.12);
  g.gain.setValueAtTime(0.9, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.24);
  osc.connect(g).connect(out);
  osc.start(t);
  osc.stop(t + 0.26);
}

function hat(c: AudioContext, out: GainNode, t: number) {
  const src = c.createBufferSource();
  src.buffer = noise(c);
  const hp = c.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = 7000;
  const g = c.createGain();
  g.gain.setValueAtTime(0.16, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
  src.connect(hp).connect(g).connect(out);
  src.start(t, 0.2, 0.06);
}

function pad(c: AudioContext, out: GainNode, t: number, beat: number, root: number) {
  // a bar long fifth, re-struck every four beats
  if (beat % 4 !== 0) return;
  for (const f of [root, root * 1.5]) {
    const osc = c.createOscillator();
    osc.type = "triangle";
    osc.frequency.value = f;
    const g = c.createGain();
    const dur = beatLen * 4;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.05, t + dur * 0.2);
    g.gain.linearRampToValueAtTime(0, t + dur);
    osc.connect(g).connect(out);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }
}

function schedule(c: AudioContext, out: GainNode, id: SourceId, bpm: number) {
  while (nextBeat < c.currentTime + LOOKAHEAD_S) {
    kick(c, out, nextBeat);
    hat(c, out, nextBeat + beatLen / 2);
    if (id !== "pulse") hat(c, out, nextBeat + beatLen * 0.75);
    pad(c, out, nextBeat, beatIndex, bpm >= 140 ? 98 : 65.4);
    beatIndex += 1;
    nextBeat += beatLen;
  }
}

function startSynth(src: SoundtrackSource) {
  const g = audioGraph();
  if (!g || !src.bpm) return;
  const gain = g.ctx.createGain();
  gain.connect(g.bus);
  synthGain = gain;
  beatLen = 60 / src.bpm;
  beatIndex = 0;
  nextBeat = g.ctx.currentTime + 0.08;
  timer = window.setInterval(() => schedule(g.ctx, gain, src.id, src.bpm ?? 120), TICK_MS);
}

function stopSynth() {
  if (timer != null) window.clearInterval(timer);
  timer = null;
  const gain = synthGain;
  synthGain = null;
  if (!gain) return;
  // voices are scheduled ahead and a pad runs a full bar, so cutting the timer
  // is not enough. Duck the branch and drop it once the tail is inaudible.
  const g = audioGraph();
  if (g) gain.gain.setTargetAtTime(0, g.ctx.currentTime, 0.02);
  window.setTimeout(() => gain.disconnect(), 400);
}

/* --------------------------------------------------------------- playback */

/* WHO IS TOLD WHEN THE SOUND STARTS OR STOPS. A credited track may not play
 * without its credit on screen, so the thing that raises the credit cannot be
 * allowed to miss the moment: this is an event, not a poll and not a per frame
 * read. It matters because a render loop is not a reliable clock here. The
 * field drops to an on demand loop under prefers-reduced-motion, so a page
 * that is only listening runs no frames at all, and a credit that waited for
 * one would never appear while the music played.
 *
 * Everything that can change whether sound is coming out reports here: the
 * element's own playing, pause and ended events (see element(), which covers
 * an autoplay the browser held back until the first click), and the two synth
 * calls that have no element to speak for them. */
const listeners = new Set<(playing: boolean) => void>();
let told = false;

function tell(): void {
  const now = isPlaying();
  if (now === told) return;
  told = now;
  for (const cb of listeners) cb(now);
}

/** Listen for sound starting and stopping. Calls back at once with the state
 *  as it stands, and returns the unsubscribe. */
export function onSounding(cb: (playing: boolean) => void): () => void {
  listeners.add(cb);
  cb(isPlaying());
  return () => {
    listeners.delete(cb);
  };
}

let el: HTMLAudioElement | null = null;
let uploadUrl: string | null = null;
let uploadFileName: string | null = null;
let current: SoundtrackSource | null = null;
let disarm = () => {};

/* The single <audio> element every file source shares. It is shared because a
 * MediaElementAudioSourceNode can be created only once per element, ever:
 * swapping .src keeps the analyser tap alive across track changes. */
function element(): HTMLAudioElement | null {
  if (typeof window === "undefined") return null;
  if (!el) {
    el = new Audio();
    el.loop = true;
    el.preload = "none";
    // volume lives on the master gain in beat.ts, so every source obeys one
    // control and the analyser still sees the mix at unit gain.
    el.volume = 1;
    // the element says when it starts and stops, so nothing has to watch it:
    // an autoplay the browser held until the first click announces itself the
    // moment it is let through, and a track paused by the operating system
    // (another tab taking the audio focus) announces that too
    el.addEventListener("playing", tell);
    el.addEventListener("pause", tell);
    el.addEventListener("ended", tell);
  }
  return el;
}

function stopElement() {
  disarm();
  disarm = () => {};
  if (el) el.pause();
}

function playElement(src: string) {
  const node = element();
  if (!node) return;
  if (node.src !== src) {
    node.src = src;
    node.load();
  }
  // must precede play: once routed, the element's sound only reaches the
  // speakers through the resumed context.
  attachElement(node);
  resumeAudio();
  // On a fresh load the browser blocks playback until the user has interacted.
  // Try now, and if refused arm the next gesture to try again, so the choice
  // is not silently lost.
  const start = () => {
    resumeAudio();
    void node.play().catch(() => {});
    disarm();
    disarm = () => {};
  };
  void node.play().catch(() => {
    window.addEventListener("pointerdown", start, { once: true });
    window.addEventListener("keydown", start, { once: true });
    disarm = () => {
      window.removeEventListener("pointerdown", start);
      window.removeEventListener("keydown", start);
    };
  });
}

/* Start a source, stopping whatever was playing. Idempotent: asking for the
 * source that is already current does nothing but resume the context, so this
 * is safe to call from an effect that re-runs. Unknown ids are ignored, and so
 * is the upload source with no file loaded. */
export function playSource(id: SourceId | string): void {
  const src = sourceById(id);
  if (!src) return;
  if (src.kind === "upload" && !uploadUrl) return;
  if (current && current.id === src.id) {
    resumeAudio();
    return;
  }
  stopSource();
  current = src;
  if (src.kind === "synth") {
    resumeAudio();
    startSynth(src);
    // the graph is created lazily by startSynth, so resume again now that it
    // exists. Still the same user gesture, so the browser allows it.
    resumeAudio();
    // a pattern has no element to announce itself, so it is announced here
    tell();
    return;
  }
  const file = src.kind === "upload" ? uploadUrl : TRACK_FILES[src.id];
  if (file) playElement(file);
}

/* Stop everything. The envelope decays to 0 on its own once the graph goes
 * quiet, so nothing downstream needs telling. */
export function stopSource(): void {
  stopSynth();
  stopElement();
  current = null;
  // the element's own pause event covers the file path; this is what closes
  // the synth path, and it is harmless on both (tell only speaks on a change)
  tell();
}

/* Master volume, 0..1, across every source. Ramped, so a slider drag is
 * smooth. Does not affect the signal: the analyser taps ahead of it. */
export function setVolume(v: number): void {
  setMasterVolume(v);
}

/* Hand over a user picked file. Does not start playback: call
 * playSource(UPLOAD_ID) right after, from the same event handler, so the
 * gesture still counts. Replacing a file releases the previous object URL. */
export function loadUpload(file: File): void {
  if (uploadUrl) {
    if (current && current.kind === "upload") stopSource();
    URL.revokeObjectURL(uploadUrl);
  }
  uploadUrl = URL.createObjectURL(file);
  uploadFileName = file.name;
}

/* The loaded file's name, for a UI that wants to show it in place of the
 * upload source's placeholder label. Null until loadUpload is called. */
export function uploadName(): string | null {
  return uploadFileName;
}

export type AudioSignal = {
  /** 0..1 low band transient. Snaps on a kick, glides back between. */
  beat: number;
  /** 0..1 broadband loudness. Slow, follows intensity rather than pulse. */
  level: number;
  /** whether sound is actually reaching the graph this frame. */
  playing: boolean;
};

// one object, reused every frame. A per frame allocation in a render loop is
// exactly the kind of litter this repo avoids, so callers read the fields and
// do not retain the object.
const signal: AudioSignal = { beat: 0, level: 0, playing: false };

function isPlaying(): boolean {
  if (!current) return false;
  if (current.kind === "synth") return timer != null;
  return el != null && !el.paused && !el.ended;
}

/* Advance the analyser and read it. Call ONCE per frame with the frame delta
 * in seconds, and spend the numbers there: every send the host has comes off
 * that one read, so nothing downstream ever samples the analyser a second time.
 * Returns the shared signal object, so copy the numbers out if you need to keep
 * them past the frame. */
export function sampleAudio(dt: number): AudioSignal {
  sampleEnvelope(dt);
  signal.beat = beatValue();
  signal.level = levelValue();
  signal.playing = isPlaying();
  return signal;
}
