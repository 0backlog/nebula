/* The demo's METRONOME, one of the two things that can drive DsField.energy
 * here. The other is the real one: whatever is playing, read off a Web Audio
 * analyser (beat.ts, sampleAudio in soundtrack.ts). This is the clock for the
 * mode where nothing is playing at all, so the reactive path stays visible with
 * no source picked and no file loaded. The engine only ever asks for a 0..1
 * number per frame, and both arrive as exactly that, which is what lets one
 * dial own how hard a hit lands whichever is beating.
 *
 * The depth is the caller's: this returns a full strength hit, and app.tsx
 * scales it by the pulse reach the way it scales the analyser's. */

let phase = 0;

export function pulse(dt: number, bpm: number): number {
  // a phase accumulator, not a clock: a bpm change only alters the rate the
  // phase advances from where it is, so scrubbing the slider never teleports
  // the kick
  phase = (phase + (dt * bpm) / 60) % 1;
  return Math.exp(-phase * 5);
}
