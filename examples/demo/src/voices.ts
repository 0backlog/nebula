/* The face's own speech, kept apart from the music.
 *
 * A face is driven by a voice, so the samples here are speech: one speaker,
 * evenly paced, informational, which is the register an assistant speaks in and
 * the register the mouth reads best. The soundtrack's five tracks live in
 * soundtrack.ts and are never offered here, because a song drives a mouth into
 * nonsense.
 *
 * PROVENANCE. All five are NASA recordings, which are works of the United
 * States government and therefore in the public domain: no license to satisfy
 * and no attribution required, which is deliberately unlike the music. Each
 * still carries NASA in its own tags, and each keeps the source recording's own
 * filename as its title tag, so a reader can match a shipped file against the
 * archive listing without asking us. That is the point: a public domain claim
 * in a NOTICE is the assertion a stranger reuses this demo on, so it only
 * covers files that evidence it themselves. Another clip shipped here until the
 * open sourcing pass and was dropped for failing exactly that test. They are
 * trimmed, loudness normalized to -16 LUFS so the analyser meets a level it can
 * work with, downmixed to mono and re-encoded at 56 kbps, so each file is under
 * 100 KB. Sources are in NOTICE.
 *
 * The files are played through the FACE's analyser (attachFaceAudio), never the
 * soundtrack's, so the two paths stay separate all the way down. */

/** a bundled speech clip: the id the menu passes around and the file behind it */
export type VoiceClip = { id: string; label: string; file: string };

// public/ is served from the root, and BASE_URL keeps that true under a subpath
const asset = (name: string) => `${import.meta.env.BASE_URL}${name}`;

/* Every label is a one word reduction of what NASA's own catalog calls the
 * recording, so a label never claims more about a clip than the archive does. */
export const VOICE_CLIPS: readonly VoiceClip[] = [
  { id: "voice-briefing", label: "Briefing", file: asset("voice-briefing.mp3") },
  { id: "voice-countdown", label: "Countdown", file: asset("voice-countdown.mp3") },
  { id: "voice-hold", label: "Hold", file: asset("voice-hold.mp3") },
  { id: "voice-recorders", label: "Recorders", file: asset("voice-recorders.mp3") },
  { id: "voice-sendoff", label: "Sendoff", file: asset("voice-sendoff.mp3") },
];

/** the file behind a clip id, or undefined for anything that is not a clip
 *  (the simulation and the user's own upload are not files this module owns) */
export function voiceClipFile(id: string): string | undefined {
  return VOICE_CLIPS.find((c) => c.id === id)?.file;
}
