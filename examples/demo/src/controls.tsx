import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { dial10, type FieldCursorMode } from "@0backlog/nebula";
import { SOUNDTRACK_SOURCES, sourceById, UPLOAD_ID, uploadName, type SourceId } from "./soundtrack";
import { VOICE_CLIPS } from "./voices";

/* The controls. Two floating cards over a full-bleed canvas: the PICKER on the
 * left, which is every formation the demo registers, grouped by what it is (and
 * the face's own controls, under the face, while the face is on screen), and the
 * PANEL on the right, which is every setting, grouped by what it does.
 *
 * Every control is bound to the RAW prop range, not to a display scale, so
 * reading this file tells you what the engine actually accepts. That range is
 * almost always the same one: the public API is 0..10 dials where 5 is the
 * tuned nominal, so a dial here is <Slider> with no range at all. Exactly one
 * control keeps real units and says so at the call site: bpm, a real tempo.
 * Even the point count is a dial now, resolved to points by pointsAt below.
 *
 * Labels are the human name, keys are the API name, and they are allowed to
 * differ: `rounding` is the `round` prop, `brightness` is the `intensity` prop,
 * `count` is `points`. Every visible label is UNIQUE, which is what lets the
 * hover cards be keyed on the label itself. A spotlight's block is the one place
 * that cannot hold: its four controls are named plainly, the block's heading
 * numbers the pocket, and those cards are passed in from the same one place
 * every other card lives. Their ACCESSIBLE names keep the number, so a screen
 * reader never hears "color" four times with nothing to tell them apart.
 *
 * A section that can be off says so on its own heading: the switch is part of
 * <Section>, which OWNS that section's controls, and turning it off folds them
 * away rather than greying them, on a transition rather than a snap. Cursor,
 * Spotlights and each single light pocket carry one.
 *
 * PULSATION carries THE ONE EXCEPTION, and it is deliberate. Its switch is a
 * TRANSPORT: what it turns on is something playing, so it is drawn as the
 * face's own play and pause, and pausing leaves the whole section exactly where
 * it was, mounted, reachable and at full strength. A source, a tempo and the
 * three reach dials are what a person sets BEFORE pressing play, and a
 * transport that folded them away would be asking for them in the dark. What
 * the fold used to carry for it is carried where it always belonged: paused,
 * the three sends resolve to 0 in app.tsx, so nothing pulses. It ripples no
 * further. Every other section still folds, and nothing here is ever dimmed.
 *
 * ONE PATTERN answers everything that does not apply to what is on screen: it
 * is HIDDEN, on the same fold and fade, never dimmed. Two rules come with it.
 * A section whose every control is hidden takes its heading with it (Formation
 * and Orientation both go on a flat field). And nothing hidden reaches the
 * engine, or the panel would be lying: cursor off passes mode "off" AND trail
 * 0, and spotlights off pass an empty list.
 *
 * The panel is CONTROLS ONLY. Nothing here explains itself in prose: every
 * capsule carries a hover card and so does every section heading, and all of
 * that copy sits in TIPS, in one place, reviewable at a glance. */

/** the buffer the field allocates once, in points. Every formation here builds
 *  at most this many, so a count change MORPHS instead of remounting. */
export const CAPACITY = 15000;

/* the count dial's real span. A raw count was the odd one out in a panel of
 * dials, so it is a dial too: 0 is the sparsest dust worth looking at, 5 is the
 * 9000 points the demo has always built at, and 10 is the capacity, because the
 * buffer is the honest ceiling. The resolved count shows in the hover card. */
const POINTS_MIN = 1000;
const POINTS_NOMINAL = 9000;

/** the count dial resolved to a real point count. */
export const pointsAt = (dial: number) =>
  Math.round(dial10(dial, POINTS_MIN, POINTS_NOMINAL, CAPACITY));

/** the page palette. "system" defers to prefers-color-scheme; styles.css
 *  holds both halves and app.tsx writes the choice onto <html>. */
type Theme = "dark" | "light" | "system";

/** the dot color, one per theme: a dark page wants light dots and a light page
 *  wants dark ones. Each one is the OTHER theme's page background, so a dot is
 *  the same 240 levels away from the page either way. Both live in the config
 *  at once and both stay editable; the theme SELECTS one, it never overwrites
 *  the other, so a color picked for the light page survives a trip through the
 *  dark one. (The prop they feed is `tint`, which is why the config keys keep
 *  the API's word for it and the panel says color.) */
const TINT_DARK = "#fafafa";
const TINT_LIGHT = "#0a0a0a";

/** the theme's default brightness dial, the color's other half. Equal levels
 *  are not equal presence: a light dot over black is a light source, a dark dot
 *  over white is a veil, so the same alpha that reads as a cloud on the dark
 *  page reads as haze on the light one. A light page needs close to double.
 *  5 is every formation's opacity as built (the intensity prop resolves to
 *  1.0), 7 resolves to 1.8. Unlike the color this one is a single value, so the
 *  theme RESETS it; moving the dial owns it again until the theme changes. */
export const INTENSITY_DARK = 5;
export const INTENSITY_LIGHT = 7;

/** how many light pockets ride at once. The engine honors four and ignores the
 *  rest, so the + button stops there. */
export const SPOT_MAX = 4;

/* One color per pocket, handed out in order, and TWO of them: a pocket carries
 * a light-page color and a dark-page one, the way the dots do, and the theme
 * selects which is live.
 *
 * THE FIRST ONE IS NEUTRAL, and the three after it are not. The first pocket is
 * the one a person meets, so it lights the cloud without recoloring it: what
 * that pocket demonstrates is the POCKET, a bright place with no edge, and a
 * hue there is a second thing to explain in the same moment. The others are far
 * enough apart in hue that adding a second pocket shows what the first one hid,
 * that a pocket tints the points it lifts, and that two overlapping pockets
 * visibly MIX rather than agree.
 *
 * The light set is the same set carried down in value: a pocket tints the dots
 * it lifts, and dark dots on a white page can only lean toward a color darker
 * than the page they sit on. */
const SPOT_TINTS_DARK = ["#eceae7", "#6bc8ff", "#c48bff", "#7dffb2"];
const SPOT_TINTS_LIGHT = ["#3f3f46", "#0a6ea8", "#6a3bbf", "#127a4a"];

/* where a new pocket lands, as a fraction of the stage, so adding one puts it
 * somewhere you can see instead of exactly on top of the last one */
const SPOT_SPAWN: [number, number][] = [
  [0, 0],
  [-0.24, 0],
  [0.24, 0],
  [0, 0.26],
];

/** one light pocket, as the panel holds it. x and y are WORLD units (the space
 *  the gather hook speaks), z is a 0..10 depth dial with 5 on the z = 0 plane,
 *  and the color is kept apart from whether it is passed at all: off is the
 *  prop's own default, the pocket that only brightens, so a color survives
 *  being switched off and come back to. */
type SpotCfg = {
  id: number;
  /** the pocket's own switch. Off is not in the list the hook returns at all,
   *  so the engine eases it away instead of cutting it. */
  on: boolean;
  x: number;
  y: number;
  z: number;
  intensity: number;
  radius: number;
  /** one pocket color per theme, held exactly the way the dot color is: both
   *  stay editable, the theme SELECTS the live one and never writes the other,
   *  so a color picked for one page survives a trip through the other. */
  tintLight: string;
  tintDark: string;
  tintOn: boolean;
  /** whether this pocket is placed in DEPTH: the position control's 2D/3D
   *  toggle, which only a formation with a front has anywhere to put. */
  depth: boolean;
};

/* ids are only for React's list keys, so removing the middle block cannot hand
 * its open z mode to the one that slides up into its place */
let spotSeq = 1;

const newSpot = (i: number, world: { w: number; h: number }): SpotCfg => {
  const [fx, fy] = SPOT_SPAWN[i % SPOT_SPAWN.length];
  return {
    id: spotSeq++,
    // a pocket you just asked for should be lit, or the + button looks broken
    on: true,
    x: fx * world.w,
    y: fy * world.h,
    z: 5,
    intensity: 5,
    radius: 5,
    tintLight: SPOT_TINTS_LIGHT[i % SPOT_TINTS_LIGHT.length],
    tintDark: SPOT_TINTS_DARK[i % SPOT_TINTS_DARK.length],
    tintOn: true,
    depth: false,
  };
};

/** what the pulsation section is listening to: the demo's own metronome (no
 *  audio at all) or one of the analyser's sources. Nothing is not a choice
 *  here, it is the section's own switch. */
export type PulseType = "beat" | SourceId;

/** the simulated agent stream: setFaceDrive, no audio and no element. */
export const VOICE_SIM = "sim";
/** the user's own file, through the face's element. It is its own id rather
 *  than the soundtrack's UPLOAD_ID, since the two uploads are two files. */
export const VOICE_UPLOAD = "voice-upload";

/** What the face's mouth is coming from. THE VOICE AND THE SOUNDTRACK ARE TWO
 *  QUESTIONS, asked of two analysers, so this id space is the face's own and
 *  none of the music's ids are in it: the simulation, the bundled speech in
 *  voices.ts, and whatever file you hand it. */
export type VoiceId = typeof VOICE_SIM | typeof VOICE_UPLOAD | string;

export type Config = {
  formation: string;
  mode: FieldCursorMode;
  /** the cursor section's switch. Off passes mode "off" and hides the rest,
   *  and the mode above is remembered for the way back. */
  cursorOn: boolean;
  /** the page theme, the one control here that is not an engine input. It
   *  still reaches the canvas: it picks the live color and the brightness. */
  theme: Theme;
  /** one dot color per theme. The theme selects the live one and never writes
   *  the other, so a color picked for one page survives a trip through the
   *  other. */
  tintLight: string;
  tintDark: string;
  /** DsField props, all of them 0..10 dials at their real range */
  additive: number;
  shine: number;
  trail: number;
  round: number;
  intensity: number;
  parallax: number;
  spin: number;
  shuffle: number;
  transition: number;
  mobile: number;
  /** FieldFormation fields, applied to every formation in the registry */
  points: number;
  size: number;
  chaos: number;
  reach: number;
  force: number;
  /** build inputs every 3D formation takes: a multiplier on its world radius,
   *  and how far its points scatter off the surface they were drawn from */
  scale: number;
  diffusion: number;
  /** host hooks. The orientation is three dials over one payload: how far the
   *  target leans (the demo's), how fast the cloud gets there (the payload's
   *  own speed) and how long it waits first (the demo's again). */
  bend: number;
  look: number;
  lookAmp: number;
  lookLag: number;
  /** the light pockets, up to SPOT_MAX of them, and the section's switch */
  spotsOn: boolean;
  spotlights: SpotCfg[];
  /** the beat. `bpm` is a real tempo, everything else is a dial, and pulseOn
   *  is the section's switch: off stops every source. */
  pulseOn: boolean;
  bpm: number;
  pulseType: PulseType;
  volume: number;
  /** the audio sends: how much of the analyser's signal reaches each aspect.
   *  0 means that aspect ignores the music entirely. */
  sendPulse: number;
  sendChaos: number;
  sendBright: number;
  /** face dials, pushed through setFaceGesture */
  faceMod: number;
  faceBlink: number;
  /** how loud the face's voice plays. It is the FACE's own level, not the
   *  music's: the two are separate sources on separate graphs, and this one
   *  lands on the element the face's analyser listens to. */
  voiceVolume: number;
};

export const DEFAULTS: Config = {
  // a volume opens the demo: the sphere is the shape that shows what the field
  // is (depth, orient, the build dials) in one glance, where a flat scatter
  // reads as a background and hides half the panel behind it
  formation: "sphere",
  mode: "repel",
  cursorOn: true,
  theme: "dark",
  tintLight: TINT_LIGHT,
  tintDark: TINT_DARK,
  additive: 5,
  shine: 5,
  trail: 0,
  round: 10,
  // the theme owns this one from mount on
  intensity: INTENSITY_DARK,
  parallax: 5,
  // a drag turns the cloud at the engine's own natural feel
  spin: 5,
  shuffle: 5,
  transition: 5,
  mobile: 5,
  points: 5,
  size: 5,
  chaos: 5,
  reach: 5,
  force: 5,
  scale: 5,
  diffusion: 5,
  bend: 5,
  look: 5,
  lookAmp: 5,
  lookLag: 5,
  // one pocket, put away: its color is armed and waiting rather than hidden, so
  // a colored light costs nothing until someone flips its switch
  spotsOn: true,
  spotlights: [
    {
      id: 0,
      on: false,
      x: 0,
      y: 0,
      z: 5,
      intensity: 5,
      radius: 5,
      tintLight: SPOT_TINTS_LIGHT[0],
      tintDark: SPOT_TINTS_DARK[0],
      tintOn: true,
      depth: false,
    },
  ],
  /* THE SOUNDTRACK. A field that reacts to music is the thing this
   * component does that a screenshot cannot show. The transport arrives PAUSED
   * with Shotgun loaded in the menu: browsers refuse audio before a gesture,
   * so a demo that claims to arrive playing arrives lying. One press of play
   * starts the bundled track that carries the clearest kick, which is what the
   * pulse reads; it is a credited track, so the deck raises its credit the
   * moment the sound is actually audible (app.tsx). The volume starts a touch
   * under the nominal because arriving loud is not arriving well. */
  pulseOn: false,
  bpm: 120,
  pulseType: "shotgun",
  volume: 4,
  // the sends are nominal from mount, so picking a source moves the field the
  // moment it plays instead of after a hunt through the panel
  sendPulse: 5,
  sendChaos: 5,
  sendBright: 5,
  faceMod: 5,
  faceBlink: 5,
  voiceVolume: 5,
};

/* The picker's three groups, which are the three ways a formation READS: flat
 * fields that fill the frame, volumes with depth, and the face. (Under them sit
 * four ways to BUILD one: a formation factory, a three.js geometry, a
 * composition of several, and the face asset.) */
const FLAT = [
  // the first three are ONE factory in its three flows, which is why the keys
  // keep the library's word for it while the pills say what each one looks
  // like: a still field, one falling, one running sideways
  { value: "curtain-still", label: "Plain" },
  { value: "curtain-down", label: "Waterfall" },
  { value: "curtain-right", label: "River" },
  { value: "lattice", label: "Lattice" },
  { value: "cloud", label: "Cloud" },
  { value: "stream", label: "Stream" },
  // the sand timer, read as a field: two bells, a waist, and the fall through
  // it that never runs out
  { value: "time", label: "Time" },
];

/* every shape here is a volume with a FRONT, which is why ORIENTED below is
 * simply this list plus the face. It is not the same thing as the 3D group in
 * the picker: two of the volumes down there track the viewport and have no
 * front to turn, so they are grouped with the shapes and gated with the
 * fields. */
const SHAPES = [
  { value: "sphere", label: "Sphere" },
  { value: "cube", label: "Cube" },
  { value: "pyramid", label: "Pyramid" },
  { value: "octahedron", label: "Octahedron" },
  { value: "dodecahedron", label: "Dodecahedron" },
  { value: "capsule", label: "Capsule" },
  { value: "torus", label: "Torus" },
  { value: "diamond", label: "Diamond" },
  { value: "spring", label: "Spring" },
  { value: "mobius", label: "Mobius" },
  { value: "torus-knot", label: "Torus knot" },
  { value: "icosahedron", label: "Icosahedron" },
  { value: "ring", label: "Ring" },
  { value: "saturn", label: "Saturn" },
  { value: "atom", label: "Atom" },
  { value: "hourglass", label: "Hourglass" },
  { value: "galaxy", label: "Galaxy" },
  { value: "tornado", label: "Tornado" },
  { value: "rose", label: "Rose" },
  { value: "bitcoin", label: "Bitcoin" },
  { value: "dna", label: "DNA" },
  { value: "flower", label: "Flower" },
  { value: "veins", label: "Veins" },
];

/* the two fields that read as VOLUMES: a slab of cloud split into two lobes,
 * and a ground plane receding into the distance. Both are built against the
 * live viewport and place their own points, so they group with the shapes and
 * gate with the fields. */
const VOLUMES = [
  { value: "beats", label: "Beats" },
  { value: "horizon", label: "Horizon" },
];

/** the picker's 3D group: everything that reads with depth, whatever built it,
 *  IN ALPHABETICAL ORDER, since twenty five shapes in build order is a list you
 *  read rather than one you look something up in. It is the DISPLAY that is
 *  sorted, not the two groups above: which group a formation is in is what
 *  ORIENTED and SPATIAL are derived from, so moving an entry between them would
 *  change how the engine treats it. Sets read membership, never order.
 *  The locale is pinned so the row cannot come out in a different order on a
 *  page whose language is not the labels'. */
const SOLIDS = [...SHAPES, ...VOLUMES].sort((a, b) => a.label.localeCompare(b.label, "en"));

const FACE = [{ value: "face", label: "Talking face" }];

/** formations with a front to turn toward the cursor: the orient hook in
 *  app.tsx gates on this, the orientation section is hidden for everything
 *  else, and the third axis of a locator is only offered here. The two viewport
 *  volumes are deliberately NOT in it: they read as volumes, they have no
 *  front. */
export const ORIENTED = new Set([...SHAPES.map((o) => o.value), ...FACE.map((o) => o.value)]);

/** everything built as a VOLUME: the picker's whole 3D group plus the face.
 *  Every one of them takes the two build dials, scale and diffusion, and every
 *  one of them turns under a drag. A flat field takes neither: it has no radius
 *  to multiply, no surface to scatter off, and no front to turn. */
export const SPATIAL = new Set([...SOLIDS.map((o) => o.value), ...FACE.map((o) => o.value)]);

const MODES: FieldCursorMode[] = ["repel", "attract", "vortex"];

const NEXT_THEME: Record<Theme, Theme> = { dark: "light", light: "system", system: "dark" };

const SYNTHS = SOUNDTRACK_SOURCES.filter((s) => s.kind === "synth");
const TRACKS = SOUNDTRACK_SOURCES.filter((s) => s.kind === "track");

/* Every hover card, in one place so the copy is reviewable at a glance. Keys
 * are the VISIBLE LABEL of the control, or the heading's own key with an "s "
 * in front. The spotlight blocks are the one place a label repeats, since the
 * pocket's number lives in its heading rather than in its controls: those four
 * cards are keyed on the plain name and handed to the capsule directly. The two
 * controls that show a GLYPH instead of a label are keyed the same way, on what
 * they are, since there is no word on them to key one on. This is also
 * where the prose that used to sit in the panel went: the panel itself is
 * controls only now. */
const TIPS: Record<string, string> = {
  // the picker's groups
  "s 2d": "Flat fields that fill the frame, most of them built against the live viewport. Each pill is one FieldFormation in the registry the demo hands DsField.",
  "s 3d": "Everything with depth: three.js geometries sampled across their surface, compositions of several parts, parametric shapes, and two viewport fields. All of them take scale and diffusion, and a drag turns any of them.",
  "s face": "A landmark head, driven by an audio element through the analyser or by a voice agent pushing amplitude. Its transport rides its own pill and the rest of its controls sit under it, while it is on screen.",
  // the panel's sections
  "s formation": "Scale and diffusion are baked into the point positions, so moving either resamples the cloud and it morphs into the result. Spin needs no rebuild.",
  "s space": "Where the cloud sits as one object. It is centered between the two cards rather than on the canvas: the demo measures what they cover and passes it as the inset prop.",
  "s orientation": "The cloud turns its front toward the cursor. How far, how fast, and how far behind the pointer it runs.",
  "s cursor": "What the pointer does to the dots within its radius. The field only listens while the pointer is over the canvas, so a drag on these controls never moves it.",
  "s dots": "The mark itself, and how many of them there are.",
  "s light": "What color the dots are and how the cloud is lit as a whole. The pockets that fall on parts of it have their own section below.",
  "s spotlights": "Up to four pockets of light, placed in the world units the gather hook speaks. They compose: a dot inside two is lit by both, and colored ones mix.",
  "s spotlight": "Off drops this pocket from the list the hook returns, so the engine eases it out instead of cutting it.",
  "s transitions": "The morph that runs on every change of formation.",
  "s pulsation": "What the cloud listens to: the demo's metronome, a pattern synthesized in the browser, a bundled track, or your own file. Everything but the metronome runs through one analyser, read once a frame. The three reach dials are where that signal goes: each adds to the dial it lands on, written straight onto the objects the engine reads each frame.",
  // formation
  scale: "Multiplies the formation's own world radius. 5 is the radius it ships with, 10 is double.",
  spin: "How far a drag on the canvas turns the cloud, and how long it coasts after. Sideways turns it around Y, up and down around X. 0 ignores the drag.",
  diffusion: "How far each point sits off the surface it was drawn from. 0 is a crisp shell, 5 reads as dust, 10 a soft silhouette.",
  // the face's own controls, in the picker card under the face
  voice: "The simulation pushes an amplitude envelope through setFaceDrive, the entry point a voice agent calls as TTS chunks arrive. Your own file plays through attachFaceAudio and the face's own analyser, which is what a recorded clip or a WebRTC track looks like to it. The soundtrack is a separate source on a separate analyser and is never listed here.",
  // a transport carries a glyph and no word, so its card is keyed on what it is
  // rather than on a label, and Toggle looks both transports up under that name
  "voice transport": "Starts and stops the selected source, on the face's own line. Stopping closes the mouth rather than freezing it open, and a sample that runs out ends the same way.",
  "voice volume": "How loud the face's own voice plays: 10 is the file at the level it was recorded, 5 is half of it. The face's analyser sits on that element, so this levels the MOUTH with the ear: at 0 the clip runs silent and the face runs still. The soundtrack's volume is a separate control over a separate graph, and its analyser taps ahead of the gain, so the cloud reads the music the same at any level. The simulation pushes amplitude rather than sound, so there is nothing to level on it and the dial is not offered.",
  modulation: "Jaw and lip travel. 5 is nominal, 10 double.",
  blink: "Blink rate. 5 is nominal, 0 stops blinking.",
  // space
  bend: "Curves space toward the cursor, with a falloff the width of the page.",
  move: "The cloud drifts with the cursor and eases home when it leaves.",
  // orientation
  amplitude: "How far the cloud turns. 5 is the tuned lean, 10 doubles it, 0 keeps the front facing you.",
  speed: "How fast it reaches that angle, the orient payload's own speed. 0 stops it following the cursor.",
  delay: "How far back down the pointer's recorded path the target is read. 10 trails the cursor by 0.6 seconds.",
  // cursor
  effect: "What the cursor does to the dots it reaches: push them away, pull them in, or swirl them.",
  radius: "How far the cursor reaches into the cloud. 5 is the tuned reach.",
  strength: "How hard the cursor pushes or pulls. 0 leaves the dots where they are.",
  trail: "Dots the cursor sweeps pick up its velocity, then spring home.",
  // dots
  color: "One dot color per theme, each half of the pill opening the panel's own picker: a saturation and value area, a hue, and a hex you can type. Both stay editable, the theme selects the live one and leaves the other alone.",
  "mobile reduction": "Under 768px of canvas the count is scaled by this over 10. 10 keeps every dot, 5 draws half.",
  size: "Dot size. 5 is 0.032 world units.",
  rounding: "The dot's mark, a hard square at 0 and a circle at 10.",
  chaos: "Per-point drift at rest. 0 holds the build still.",
  brightness: "Multiplies every formation's resting opacity. 5 leaves it as built; a light page starts at 7, since dark dots on white read fainter.",
  shine: "Per-point twinkle, each dot on its own clock. 0 holds every dot at one brightness.",
  additive: "Blends the dots as light instead of paint: two that overlap are brighter than either, so the cloud burns where it is thickest. 0 is a flat dot.",
  // spotlights: one card per control, shared by every pocket's block
  "spotlight color": "The dots inside the pocket lean toward this color as they brighten. One per theme, and each half of the pill opens the same picker the dots' own color does: a saturation and value area, a hue, and a hex you can type. Both stay editable and the theme selects the live one. Off passes no color at all, so the pocket only brightens them.",
  "spotlight intensity": "5 lifts the dots at the center about two and a half times. 0 leaves them as they were.",
  "spotlight radius": "5 is about 1.1 world units, drawn as the ring around the marker. It fades the whole way out, with no edge.",
  "spotlight position": "Drag the box to place the pocket. With depth, the z chip or a held shift makes a drag move it back and forth: the outer frame is near, the inner one far.",
  // transitions
  "transition speed": "How long a change of formation takes. 0 is the slowest useful crawl, 10 nearly instant.",
  shuffle: "How far points detour mid-morph. 0 is a straight line to the target.",
  // pulsation
  // the section's own switch, drawn as the transport's play and pause, so it is
  // keyed the way the voice's transport is: on what it is, not on a label
  "pulsation transport": "Starts and stops what is playing. The controls below stay where they are either way, so a source, a tempo and the three reach dials can be set before anything plays. Paused, all three reach dials resolve to 0, so none of the music reaches the cloud, and play starts on the tempo showing here.",
  type: "The metronome is the demo's own clock and makes no sound. The sample beats are a kick, an offbeat hat and a pad synthesized in the browser; the soundtracks are bundled files. Picked while paused it waits for play, since the transport is what starts sound here.",
  bpm: "Tempo, in real beats per minute. It clocks the metronome directly, and drives a sample beat by restarting its pattern at the new tempo. Moved while paused, it is the tempo play starts on; picking a new sample beat hands it that pattern's own.",
  volume: "Master level over every source. The analyser taps ahead of it, so the cloud reacts the same at any volume.",
  "pulse reach": "How much of each hit reaches the cloud: the pump, the tremble and the flash that land on the beat.",
  "chaos reach": "How much the music unsettles the dots. It follows the broadband level rather than each hit, so a busy passage keeps the cloud shivering.",
  "brightness reach": "How much the level lifts the dots' opacity. It eases in and out, so the cloud swells through a loud passage instead of blinking.",
};

type Tip = { text: string; y: number; near: "picker" | "panel" };

/* every card opens from its control's own vertical center, so the two line up,
 * and on the side of the card the control lives in: a control in the left card
 * opens rightward out of it, everything in the settings card opens leftward. */
function openTip(el: HTMLElement, text: string, onTip: (tip: Tip | null) => void) {
  const r = el.getBoundingClientRect();
  const near = r.left + r.width / 2 < window.innerWidth / 2 ? "picker" : "panel";
  onTip({ text, y: r.top + r.height / 2, near });
}

/* The hover card's handlers, shared by everything that opens one from its own
 * box: the capsules, the sliders, the locators and the headings all go through
 * here, so the same gesture opens the same card everywhere. Focus opens it too,
 * so a keyboard reaches the same copy the pointer does; the :focus-visible
 * guard keeps a mouse click from double-triggering what hover already shows.
 * React's onFocus is focusin, so a box also catches its child's focus, which is
 * what a slider's input and a capsule's control ride in on. `selfOnly` turns
 * that off for a box whose children speak for themselves: the locator's own z
 * chip should not open the box's card. */
function hoverTip(info: string | undefined, onTip: (tip: Tip | null) => void, selfOnly = false) {
  return {
    onMouseEnter: (e: React.MouseEvent<HTMLElement>) => {
      if (info) openTip(e.currentTarget, info, onTip);
    },
    onMouseLeave: () => onTip(null),
    onFocus: (e: React.FocusEvent<HTMLElement>) => {
      if (!info || !(e.target instanceof Element) || !e.target.matches(":focus-visible")) return;
      if (selfOnly && e.target !== e.currentTarget) return;
      openTip(e.currentTarget, info, onTip);
    },
    onBlur: () => onTip(null),
  };
}

/* lucide-style marks, hand-drawn here so the demo keeps its zero-dependency
 * bill: 24-unit grid, 2-unit stroke, round caps. */
function Icon({
  children,
  size = 15,
  className,
}: {
  children: React.ReactNode;
  size?: number;
  /** for a mark the layout has to place, which here is the chevron alone */
  className?: string;
}) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {children}
    </svg>
  );
}

function ThemeIcon({ theme }: { theme: Theme }) {
  if (theme === "light") {
    return (
      <Icon>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4" />
      </Icon>
    );
  }
  if (theme === "system") {
    return (
      <Icon>
        <rect x="2" y="3" width="20" height="14" rx="2" />
        <path d="M8 21h8M12 17v4" />
      </Icon>
    );
  }
  return (
    <Icon>
      <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
    </Icon>
  );
}

/* THE TRANSPORT'S GLYPH, in one place because two controls wear it: the face's
 * voice and the pulsation section's own switch. Running shows the way to stop
 * it and stopped shows the way to start it, which is what a transport says
 * everywhere else. */
function PlayPause({ on }: { on: boolean }) {
  return <Icon size={12}>{on ? <path d="M10 4v16M15 4v16" /> : <path d="M7 4v16l13-8Z" />}</Icon>;
}

/* One row of exclusive pills, wrapping, each as wide as its own label. The
 * buttons carry aria-pressed rather than radio semantics, since they are plain
 * buttons a pointer or a tab reaches one at a time. The row can carry a hover
 * card of its own, which is how the cursor's effects keep their copy now that
 * they sit bare instead of behind a label.
 *
 * The GROUP is one tab stop, not one per pill: the picker alone holds one pill
 * for every formation in the registry, and a keyboard on its way to the
 * settings would pay for every one of them. So the tab order holds the live
 * pill (or the first, in a group the choice is not in) and the arrows walk the
 * row from there, which is the traversal an exclusive choice is given everywhere
 * else. They move FOCUS only: picking is still the click or the Enter, since
 * every pick here rebuilds the cloud. */
function Pills({
  options,
  value,
  onChange,
  label,
  tip,
  onTip,
}: {
  options: { value: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
  /** the group's own name, which a group of buttons has to carry: the pills
   *  say what each choice is, never what the row of them is about */
  label: string;
  tip?: string;
  onTip?: (tip: Tip | null) => void;
}) {
  const infoId = useId();
  const card = tip && onTip;
  const box = useRef<HTMLDivElement | null>(null);
  // where the group's one tab stop sits: the last pill the arrows or a click
  // left it on, falling back to the live one
  const [stop, setStop] = useState<string | null>(null);
  const at = options.findIndex((o) => o.value === (stop ?? value));
  const cursor = at < 0 ? 0 : at;

  const walk = (e: React.KeyboardEvent) => {
    const d =
      e.key === "ArrowRight" || e.key === "ArrowDown"
        ? 1
        : e.key === "ArrowLeft" || e.key === "ArrowUp"
          ? -1
          : 0;
    if (d === 0 || options.length === 0) return;
    const j = (cursor + d + options.length) % options.length;
    setStop(options[j].value);
    box.current?.querySelectorAll<HTMLButtonElement>(".pill")[j]?.focus();
    e.preventDefault();
  };

  return (
    <div
      ref={box}
      className="pills"
      role="group"
      aria-label={label}
      aria-describedby={card ? infoId : undefined}
      onKeyDown={walk}
      {...(card ? hoverTip(tip, onTip) : {})}
    >
      {options.map((o, i) => (
        <button
          key={o.value}
          type="button"
          className={o.value === value ? "pill on" : "pill"}
          aria-pressed={o.value === value}
          tabIndex={i === cursor ? 0 : -1}
          onClick={() => {
            setStop(o.value);
            onChange(o.value);
          }}
        >
          {o.label}
        </button>
      ))}
      {card && (
        <span id={infoId} hidden>
          {tip}
        </span>
      )}
    </div>
  );
}

/* The section switch, on the heading's own line. A section that can be off
 * wears one, and off CLOSES that section's settings rather than greying them: a
 * dial you cannot move is noise, and the heading still says what is missing. It
 * is a switch, so it says so to a screen reader, its name carries the section,
 * and it points at the body it opens where it opens one. It is deliberately
 * QUIET: on it wears the same soft wash a capsule fills with, which is the one
 * language every selected state in the panel speaks (see styles.css).
 *
 * It has two DRAWINGS and one meaning. The word chip is the default, worn by
 * the cursor, the spotlights and each single pocket. `play` is the other, worn
 * by the two TRANSPORTS: the pulsation section's own switch and the face's
 * voice, which is a switch over something running rather than something set and
 * is the one place this is used outside a section. Nothing else changes here:
 * same switch role, same checked state, same value the caller resolves to when
 * it is off. Whether a section folds is <Section>'s decision, not this one's,
 * and a transport is the one switch that leaves its section open. */
function Toggle({
  on,
  name,
  controls,
  play = false,
  onTip,
  onToggle,
}: {
  on: boolean;
  name: string;
  /** the id of the body this switch opens and closes, where it opens one */
  controls?: string;
  /** draw it as a transport's play and pause instead of the word chip */
  play?: boolean;
  onTip?: (tip: Tip | null) => void;
  onToggle: (v: boolean) => void;
}) {
  const infoId = useId();
  // the glyph says start and stop where the chip says on and off, so the words
  // that reach a screen reader follow whichever one is on screen
  const act = play
    ? `${on ? "Pause" : "Play"} the ${name}`
    : `Turn ${name} ${on ? "off" : "on"}`;
  // the chip's accessible name LEADS with the word ON the switch, so "click On"
  // from a speech input reaches it (WCAG 2.5.3). A glyph has no word to lead
  // with, so it carries the plain instruction, which is also what the tooltip
  // says either way.
  const say = play ? act : `${on ? "On" : "Off"}, ${act.toLowerCase()}`;
  // a glyph carries no label to key a card on, so a transport's card is keyed
  // on what it is: TIPS holds one per transport, under that transport's name
  const info = play ? TIPS[`${name} transport`] : undefined;
  // the transport's own chip where it is drawn as one, the heading's word chip
  // otherwise, and the panel's one selected state on top of either
  const cls = play ? "capAct icon" : "toggle";
  return (
    <>
      <button
        type="button"
        className={on ? `${cls} on` : cls}
        role="switch"
        aria-checked={on}
        aria-controls={controls}
        aria-label={say}
        aria-describedby={info ? infoId : undefined}
        title={act}
        onClick={() => onToggle(!on)}
        {...(info && onTip ? hoverTip(info, onTip) : {})}
      >
        {play ? <PlayPause on={on} /> : on ? "On" : "Off"}
      </button>
      {info && (
        <span id={infoId} hidden>
          {info}
        </span>
      )}
    </>
  );
}

/* THE FOLD, the panel's ONE answer to anything that is not currently in play.
 * The content stays in the DOM either way, so closing it is a transition and
 * not a swap: the wrapper is a grid whose single row runs from 0fr to 1fr and
 * the inner box hides what does not fit yet, with the opacity riding the same
 * curve so it reads as a fade rather than a mechanical push (styles.css, where
 * reduced motion drops the animation and keeps the fold). Closed it is `inert`,
 * the one attribute that takes a subtree out of the tab order AND out of the
 * accessibility tree at once, so nothing that cannot be seen can be reached.
 *
 * A section's switch folds its body (`body`, which pulls the first control's
 * top margin so a folding section opens exactly where a plain one starts). The
 * same fold hides a lone control that has nothing to say about the formation on
 * screen, and a whole section, heading included, when every control in it
 * would be hidden. Nothing in this panel is ever dimmed instead. */
function Fold({
  open,
  id,
  body = false,
  children,
}: {
  open: boolean;
  id?: string;
  /** this is a section's body, hung under its own heading */
  body?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={body ? "fold body" : "fold"} id={id} data-open={open ? "" : undefined} inert={!open}>
      <div className="foldIn">{children}</div>
    </div>
  );
}

/* A section heading, which is a control of sorts: it carries the section's own
 * hover card, so the explanation that used to sit under the sliders as a
 * paragraph is one hover away instead of permanently in the way. Focusable, so
 * a keyboard reaches the same copy the pointer does. `action` puts one control
 * on the heading's own line (the + that adds a light pocket, the x that removes
 * one), `on` puts the section's switch at the end of it, and `sub` is the same
 * heading one level down, for a block inside a section.
 *
 * A section that can be off OWNS its body: the children are handed here rather
 * than left as siblings, so the switch has something to point at and the open
 * and close is one animated fold instead of a mount and an unmount. A section
 * with no switch renders its children exactly where they were written, which is
 * what keeps the plain sections plain. `transport` is the third case and the
 * panel's one exception: a switch over something PLAYING, so the body is
 * written out plainly like a section with no switch at all and pausing takes
 * nothing away (see the top of this file). */
function Section({
  title,
  tipKey,
  onTip,
  action,
  on,
  onToggle,
  toggleName,
  transport = false,
  sub = false,
  children,
}: {
  title: string;
  tipKey: string;
  onTip: (tip: Tip | null) => void;
  action?: React.ReactNode;
  on?: boolean;
  onToggle?: (v: boolean) => void;
  /** what the switch calls this section, if not the title lowercased */
  toggleName?: string;
  /** this section's switch is a TRANSPORT over something playing rather than a
   *  setting to turn off: it is drawn as a play and pause, and it leaves the
   *  body open and live in both states. The one section that takes it is
   *  Pulsation, and the reasoning is at the top of this file. */
  transport?: boolean;
  sub?: boolean;
  /** the section's own controls. With a switch that folds they become the
   *  fold's body; under a transport they are written out as they are. */
  children?: React.ReactNode;
}) {
  const info = TIPS[tipKey];
  const infoId = useId();
  const bodyId = useId();
  const Tag = sub ? "h3" : "h2";
  const head = (
    <Tag
      className="head"
      tabIndex={0}
      aria-describedby={infoId}
      {...hoverTip(info, onTip)}
    >
      {title}
    </Tag>
  );
  const tools = action != null || (on != null && onToggle != null);
  return (
    <>
      {tools ? (
        <div className="headRow">
          {head}
          <span className="headActs">
            {action}
            {on != null && onToggle != null && (
              <Toggle
                on={on}
                name={toggleName ?? title.toLowerCase()}
                /* a transport opens and closes nothing, so it points at
                   nothing: the body below it is there in both states */
                controls={transport ? undefined : bodyId}
                play={transport}
                onTip={onTip}
                onToggle={onToggle}
              />
            )}
          </span>
        </div>
      ) : (
        head
      )}
      {/* outside the heading, so a headings list reads "Transitions" and not
          the whole paragraph the card carries */}
      <span id={infoId} hidden>
        {info}
      </span>
      {children != null &&
        (on != null && !transport ? (
          <Fold open={on} id={bodyId} body>
            {children}
          </Fold>
        ) : (
          children
        ))}
    </>
  );
}

/* The capsule slider: a pill with the label inside on the left, the value
 * inside on the right, and a small vertical bar as the position indicator.
 * The native range input is stretched invisibly across the whole capsule, so
 * dragging, clicking, keyboard arrows and screen readers all keep working;
 * everything visible is a pointer-events:none layer above it. The capsule
 * itself owns the infotip hover, so no visible layer ever blocks the input.
 *
 * The defaults ARE the API: 0..10, one decimal, 5 nominal. A dial with nothing
 * to turn is not dimmed here, it is folded away by its caller, so there is no
 * inert state to draw. `tip` overrides the copy for a dial whose card has to
 * say something about the live value, or one whose label repeats across a
 * repeated block; `name` is the accessible name where that same repeat means
 * the visible label is not enough to tell two apart. */
function Slider({
  label,
  value,
  onChange,
  onTip,
  min = 0,
  max = 10,
  step = 0.1,
  digits = 1,
  tip,
  name,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  onTip: (tip: Tip | null) => void;
  min?: number;
  max?: number;
  step?: number;
  digits?: number;
  tip?: string;
  name?: string;
}) {
  const p = (value - min) / (max - min);
  const info = tip ?? TIPS[label];
  const infoId = useId();
  return (
    /* the capsule owns the card, focus included: the input is stretched over
       the whole pill, so the box it opens from is the same box either way, and
       one factory means hover and focus cannot drift apart here */
    <label
      className="capsule"
      style={{ "--p": p } as React.CSSProperties}
      {...hoverTip(info, onTip)}
    >
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={name ?? label}
        aria-describedby={info ? infoId : undefined}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <span className="capFill" aria-hidden />
      <span className="capThumb" aria-hidden />
      <span className="capLabel">{label}</span>
      <span className="capValue">{value.toFixed(digits)}</span>
      {info && (
        <span id={infoId} hidden>
          {info}
        </span>
      )}
    </label>
  );
}

/* The other capsule: same pill, same metrics, but the right half holds a real
 * control instead of a value. The child is a function so whatever sits in
 * there can point aria-describedby at the same card the capsule opens on
 * hover, which is how the sliders carry their copy too. */
function Cap({
  label,
  onTip,
  tip,
  children,
}: {
  label: string;
  onTip: (tip: Tip | null) => void;
  tip?: string;
  children: (describedBy: string) => React.ReactNode;
}) {
  const info = tip ?? TIPS[label];
  const infoId = useId();
  return (
    <div className="cap" {...hoverTip(info, onTip)}>
      <span className="capLabel">{label}</span>
      {children(infoId)}
      {info && (
        <span id={infoId} hidden>
          {info}
        </span>
      )}
    </div>
  );
}

/* the chevron the menu's trigger wears, so it reads as something that opens.
 * The icon set's own mark; .chev is what lays it over the capsule's edge. */
function Chevron() {
  return (
    <Icon size={13} className="chev">
      <path d="m6 9 6 6 6-6" />
    </Icon>
  );
}

/* the mark on the live row, at the menu's own weight rather than the icon set's */
function Check() {
  return (
    <svg
      className="menuMark"
      viewBox="0 0 11 11"
      width="10"
      height="10"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M2 5.5 4.5 8 9 3" />
    </svg>
  );
}

/** one group of menu rows. A group can also BE a file picker, which is the one
 *  row that opens the browser's own dialog rather than choosing a value. */
type MenuGroup = {
  label: string;
  items: { value: string; label: string }[];
  pick?: { label: string; onFile: (f: File) => void };
};

/** where a plate lands against the control it opens from, which is the CARD
 *  that control lives in said the other way round: "left" for the settings,
 *  where a plate has to grow leftward out over the canvas, and "beside" for the
 *  picker, where there is room alongside and the controls under the trigger are
 *  worth keeping in view. */
type Side = "left" | "beside";

/** the part of a DOMRect the placement reads, so it can be handed numbers */
export type PopRect = { left: number; right: number; top: number; bottom: number; width: number };
/** where the plate lands: `up` picks which of top/bottom the style uses */
export type PopBox = {
  left: number;
  width: number;
  top: number;
  bottom: number;
  maxH: number;
  up: boolean;
};

// below this much room under the trigger a plate opens upward instead, it never
// grows past the second number (it scrolls inside itself), and it keeps the
// third off either viewport edge
const POP_ROOM = 200;
const POP_MAX = 340;
const POP_EDGE = 8;

/** how wide a menu's plate is at the narrowest: a trigger in the picker card is
 *  narrow, and the rows under it are file names. It never goes under the
 *  trigger's own width either. */
const MENU_MIN = 240;

/* THE POPOVER, which is everything the two things that open a plate in this
 * panel have in common: the menus and the color picker every chip opens. One
 * copy of the portal, the placement, the focus and the dismissal, so the
 * picker cannot drift away from the menu it was cut from.
 *
 * It is portaled and fixed, because the card it lives in scrolls AND blurs: an
 * absolute plate would be clipped at the card's edge, and a fixed one inside a
 * backdrop-filter is positioned against that card rather than the viewport.
 * Fixed also means it cannot follow a scroll, so any scroll closes it, which is
 * what a plate hanging off a control should do anyway.
 *
 * Placement is the SIDE. "left" drops the plate UNDER the trigger and lines
 * their right edges up, so it grows leftward from there. "beside" puts it next
 * to the trigger instead, off its right edge and level with its top, which is
 * what a control wants when the thing under it is worth keeping visible; with
 * no room on the right it takes the left, and with no room either side it drops
 * under and grows rightward after all. Every case is clamped to the viewport so
 * nothing can clip it. Vertically it flips above the trigger when there is more
 * room up there and scrolls inside itself past POP_MAX.
 *
 * Keyboard: Escape closes and hands focus back, a pointer or a focus outside
 * closes it too, and the plate's own landing spot ([data-pop], the live one if
 * it says so) takes focus as it appears. */
/** where a plate goes, given its trigger and the room around it. Pure, and
 *  exported for the same reason it is pure: it is the one piece of this file
 *  whose correctness is a set of numbers rather than a look, so it can be
 *  checked without a browser. `vw`/`vh` are the viewport. */
export function popBox(r: PopRect, side: Side, min: number, vw: number, vh: number): PopBox {
  const width = Math.max(r.width, min);
  // BESIDE: level with the trigger and off to its right, so the control and the
  // rows under it stay in view. It only holds if the room is really there; the
  // left is the second choice and dropping under is the last, and the fallback
  // is decided here rather than left to the viewport clamp, which would slide
  // the plate back over the trigger instead of past it.
  const roomR = vw - r.right - POP_EDGE - 6;
  const roomL = r.left - POP_EDGE - 6;
  if (side === "beside" && Math.max(roomR, roomL) >= width) {
    // vertically it hangs from the trigger's top and rides up only as far as it
    // has to for its whole height to fit, so a trigger near the bottom of the
    // window gets a plate that fits rather than one that runs off the edge
    const maxH = Math.min(POP_MAX, vh - 2 * POP_EDGE);
    const top = Math.max(POP_EDGE, Math.min(r.top, vh - POP_EDGE - maxH));
    return {
      left: roomR >= width ? r.right + 6 : r.left - width - 6,
      width,
      top,
      bottom: 0,
      maxH,
      up: false,
    };
  }
  const below = vh - r.bottom - 12;
  const above = r.top - 12;
  const up = below < POP_ROOM && above > below;
  // the side it grows toward, then both edges of the viewport, in that order: a
  // plate too wide for the room left is pinned to the near edge rather than
  // hung off the far one
  const want = side === "left" ? r.right - width : r.left;
  return {
    left: Math.max(POP_EDGE, Math.min(want, vw - width - POP_EDGE)),
    width,
    top: r.bottom + 6,
    bottom: vh - r.top + 6,
    maxH: Math.min(POP_MAX, up ? above : below),
    up,
  };
}

function usePop(side: Side, min: number, onOpen?: () => void) {
  const trig = useRef<HTMLButtonElement | null>(null);
  const panel = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [box, setBox] = useState<PopBox>({ left: 0, width: min, top: 0, bottom: 0, maxH: POP_MAX, up: false });

  const show = () => {
    const r = trig.current?.getBoundingClientRect();
    if (!r) return;
    setBox(popBox(r, side, min, window.innerWidth, window.innerHeight));
    onOpen?.();
    setOpen(true);
  };

  // the landing spot takes focus as the plate appears, so the keyboard lands
  // where the eye does
  useLayoutEffect(() => {
    if (!open) return;
    const p = panel.current;
    const el =
      p?.querySelector<HTMLElement>("[data-pop][data-on]") ??
      p?.querySelector<HTMLElement>("[data-pop]");
    el?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!panel.current?.contains(t) && !trig.current?.contains(t)) close();
    };
    // a focus that landed anywhere else is the plate being left, the same way a
    // pointer outside is: it is portaled over the page, so one left open behind
    // the focus would sit there with nothing pointing at it
    const onFocusIn = () => {
      const a = document.activeElement;
      if (!panel.current?.contains(a) && !trig.current?.contains(a)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      close();
      trig.current?.focus();
    };
    // a fixed plate cannot follow the card it was measured against, so a scroll
    // anywhere but inside it closes it. Capture: scroll does not bubble.
    const onScroll = (e: Event) => {
      if (!panel.current?.contains(e.target as Node)) close();
    };
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("focusin", onFocusIn);
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("focusin", onFocusIn);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  return {
    open,
    /** the control the plate hangs off, and where focus goes back to */
    trig,
    panel,
    close: () => setOpen(false),
    toggle: () => (open ? setOpen(false) : show()),
    /** where the plate lands, straight onto the portal's own style */
    style: {
      left: box.left,
      width: box.width,
      top: box.up ? "auto" : box.top,
      bottom: box.up ? box.bottom : "auto",
      maxHeight: box.maxH,
    } as React.CSSProperties,
  };
}

/* The menu. A native select cannot be cut to this panel's language, so this is
 * a real one: the TRIGGER is a capsule with the sliders' own metrics, the label
 * on the left and the current value on the right, and the PLATE is a rounded
 * box of grouped rows with a quiet border, a divider between groups, a lit row
 * under the pointer and a mark on the live one. The portal, the placement, the
 * dismissal and the focus restore are the popover's, above.
 *
 * `side` is the card this one lives in: the voice menu sits in the picker and
 * opens BESIDE its trigger, out over the canvas, which keeps the face's other
 * controls in view while it is open; the soundtrack's sits in the settings and
 * opens leftward under its own. Neither can be pushed off an edge.
 *
 * Keyboard: it is a button, so Enter and Space open it; the arrows walk the
 * rows, Escape closes and hands focus back, and a pointer or a focus outside
 * closes it too. */
function Menu({
  label,
  value,
  valueLabel,
  groups,
  side,
  onChange,
  onTip,
}: {
  label: string;
  value: string;
  /** what the trigger shows on its right: the live row's own label */
  valueLabel: string;
  groups: MenuGroup[];
  /** which way the plate grows: the card this menu is in, said the other way */
  side: Side;
  onChange: (v: string) => void;
  onTip: (tip: Tip | null) => void;
}) {
  const pop = usePop(side, MENU_MIN, () => onTip(null));
  const file = useRef<HTMLInputElement | null>(null);
  const info = TIPS[label];
  const infoId = useId();
  const shown = groups.filter((g) => g.items.length > 0 || g.pick);

  const walk = (e: React.KeyboardEvent) => {
    if (e.key === "Tab") {
      // the plate is portaled to the END of the body, so a tab off the last row
      // walks out of the document: close and hand the focus back, and the tab
      // itself carries on from the trigger, where the menu came from
      pop.close();
      pop.trig.current?.focus();
      return;
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const rows = Array.from(pop.panel.current?.querySelectorAll<HTMLElement>("[data-pop]") ?? []);
    if (rows.length === 0) return;
    const down = e.key === "ArrowDown";
    const i = rows.indexOf(document.activeElement as HTMLElement);
    const j = i < 0 ? (down ? 0 : rows.length - 1) : (i + (down ? 1 : rows.length - 1)) % rows.length;
    rows[j]?.focus();
    e.preventDefault();
  };

  const choose = (v: string) => {
    pop.close();
    // the plate unmounts out from under the row that was just clicked, and the
    // focus would go to the body with it: hand it back to the trigger, the same
    // restore Escape does
    pop.trig.current?.focus();
    onChange(v);
  };

  return (
    <>
      <button
        ref={pop.trig}
        type="button"
        className="capsule trig"
        aria-haspopup="menu"
        aria-expanded={pop.open}
        aria-label={label}
        aria-describedby={info ? infoId : undefined}
        onClick={pop.toggle}
        {...hoverTip(info, onTip)}
      >
        <span className="capLabel">{label}</span>
        <span className="capValue">{valueLabel}</span>
        <Chevron />
        {info && (
          <span id={infoId} hidden>
            {info}
          </span>
        )}
      </button>
      {pop.open &&
        createPortal(
          <div
            ref={pop.panel}
            className="menu"
            role="menu"
            aria-label={label}
            style={pop.style}
            onKeyDown={walk}
          >
            {shown.map((g, gi) => {
              const pick = g.pick;
              return (
                <div key={g.label}>
                  {gi > 0 && <div className="menuDiv" aria-hidden />}
                  <div className="menuHead" aria-hidden>
                    {g.label}
                  </div>
                  {g.items.map((o) => (
                    <button
                      key={o.value}
                      type="button"
                      role="menuitem"
                      data-pop
                      data-on={o.value === value ? "" : undefined}
                      className={o.value === value ? "menuRow on" : "menuRow"}
                      onClick={() => choose(o.value)}
                    >
                      <span className="menuText">{o.label}</span>
                      {o.value === value && <Check />}
                    </button>
                  ))}
                  {pick && (
                    <>
                      <button
                        type="button"
                        role="menuitem"
                        data-pop
                        className="menuRow"
                        onClick={() => file.current?.click()}
                      >
                        <span className="menuText">{pick.label}</span>
                        <Icon size={12}>
                          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" />
                        </Icon>
                      </button>
                      {/* the real input, opened by the row above: the click that
                          reaches it is still the user's own, which is what keeps
                          it the gesture an AudioContext needs to resume */}
                      <input
                        ref={file}
                        className="menuFile"
                        type="file"
                        accept="audio/*"
                        tabIndex={-1}
                        aria-hidden
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          // clear the value so the same file fires change again,
                          // which is the replay path
                          e.target.value = "";
                          pop.close();
                          // the same restore the rows do: the plate goes away
                          // and the focus has to have somewhere to land
                          pop.trig.current?.focus();
                          if (f) pick.onFile(f);
                        }}
                      />
                    </>
                  )}
                </div>
              );
            })}
          </div>,
          document.body,
        )}
    </>
  );
}

/* The LOCATOR: a position, in one box, in the panel's own visual language. It
 * is a flat map of the stage for the first two axes, and the same box read as a
 * CUBE for the third: the outer frame is the near plane, the inset frame the
 * far one, and both the marker and its ring ride the frame for their own depth,
 * so pushing something back visibly walks it into the box. With no depth to
 * place, the cube and the z chip are not there at all and two axes are the
 * whole control.
 *
 * A drag moves the first two axes. The z chip switches a drag to depth, and
 * holding shift does the same without the trip to the chip; arrows nudge, and
 * in z mode the vertical pair nudges depth.
 *
 * It takes the units its caller thinks in: the spotlight hands it world units
 * and a ring for the pocket's reach. Depth arrives and leaves as a 0..1
 * position between the far and near planes, which is the only thing the box
 * itself knows about it. */
const INSET = 0.16; // how far the far plane sits inside the near one

/* The band the locator's box is held inside, whatever shape the stage really
 * is. The box would take the stage's own ratio and nothing else, so that it
 * were a scale model of what it maps, but the stage runs to two shapes that are
 * not boxes anyone can aim in. An ultrawide window leaves a strip with no
 * vertical room to place anything in: the box is 284px across in the settings
 * card, so 3 already flattens it to 95px. And below the breakpoint the stage is
 * a band about as tall as it is wide, which at the card's full width is a box
 * 340px tall, up to four of them down one scrolling column. So the ratio is
 * clamped, and where the clamp bites the box is a SQUASHED picture of the stage
 * rather than a scale model of it.
 *
 * Squashed is honest as long as nothing drawn inside it pretends otherwise,
 * which is why the box maps each axis over its OWN extent: a position is true
 * whatever shape the box ends up, and the reach is drawn as two radii rather
 * than as one circle. See the ring below. */
const BOX_MIN_ASPECT = 1.8;
const BOX_MAX_ASPECT = 3;

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const clampAbs = (v: number, half: number) => (v < -half ? -half : v > half ? half : v);

function Locator({
  label,
  tip,
  x,
  y,
  zt,
  space,
  aspect,
  ring,
  tint,
  hasDepth,
  zLabel,
  onMove,
  onDepth,
  onTip,
}: {
  /** the control's own name, since the box carries no visible label */
  label: string;
  tip: string;
  x: number;
  y: number;
  /** depth as a 0..1 position: 0 the far plane, 1 the near one */
  zt: number;
  /** what the box spans on each axis, in the units x and y are given in */
  space: { w: number; h: number };
  /** the box's own width over height. It is the stage's own ratio where the
   *  layout can take it and a clamped one where it cannot, so the box is a
   *  scale model of the stage at some sizes and a squashed picture of it at
   *  others. Everything in here is mapped per axis, so both read the same. */
  aspect: number;
  /** a reach to draw around the marker, as a RADIUS in the units x and y are
   *  given in. Absent draws no ring. */
  ring?: number;
  tint?: string;
  hasDepth: boolean;
  /** the depth readout, in whatever units the caller thinks in */
  zLabel: string;
  onMove: (x: number, y: number) => void;
  onDepth: (t: number) => void;
  onTip: (tip: Tip | null) => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [zMode, setZMode] = useState(false);
  // which axis THIS drag is writing, decided at pointerdown so a shift let go
  // mid-drag cannot switch axes underneath the pointer
  const dragZ = useRef(false);
  const infoId = useId();
  const zOn = hasDepth && zMode;
  // a formation with no depth takes the mode away rather than parking it: the
  // chip goes dead and reads off, so coming back to a shape must not silently
  // reopen the box in depth-drag mode and move z on the next drag
  useEffect(() => {
    if (!hasDepth) setZMode(false);
  }, [hasDepth]);
  const t = hasDepth ? clamp01(zt) : 1; // 1 is the near plane, the outer frame
  const k = INSET * (1 - t); // this depth's frame, inset from the box
  const span = 1 - 2 * k;
  const left = (k + (x / space.w + 0.5) * span) * 100;
  const top = (k + (0.5 - y / space.h) * span) * 100;
  const dot = 9 * (0.72 + 0.28 * t);

  const at = (e: React.PointerEvent) => {
    const r = ref.current?.getBoundingClientRect();
    if (!r || r.width < 1 || r.height < 1) return;
    const nx = clamp01((e.clientX - r.left) / r.width);
    const ny = clamp01((e.clientY - r.top) / r.height);
    if (dragZ.current) {
      // up is nearer, the way the frames themselves run
      onDepth(1 - ny);
      return;
    }
    // the inverse of the placement above: the drag reads the plane at the
    // CURRENT depth, so the marker lands under the pointer on whatever frame
    // it is riding
    onMove(
      clampAbs(((nx - k) / span - 0.5) * space.w, space.w / 2),
      clampAbs(-((ny - k) / span - 0.5) * space.h, space.h / 2),
    );
  };

  return (
    <div
      ref={ref}
      className="pos"
      style={{ "--pa": aspect } as React.CSSProperties}
      role="group"
      tabIndex={0}
      aria-label={label}
      aria-describedby={infoId}
      onPointerDown={(e) => {
        dragZ.current = zOn || (hasDepth && e.shiftKey);
        e.currentTarget.setPointerCapture(e.pointerId);
        at(e);
      }}
      onPointerMove={(e) => {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) at(e);
      }}
      onKeyDown={(e) => {
        // one nudge is a fortieth of the box, the same feel as a slider arrow
        const sx = space.w / 40;
        const sy = space.h / 40;
        // shift is the modifier on the keyboard too, so the chip is a
        // convenience rather than the only way in
        if ((zOn || (hasDepth && e.shiftKey)) && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
          onDepth(clamp01(t + (e.key === "ArrowUp" ? 0.05 : -0.05)));
        } else if (e.key === "ArrowLeft") onMove(clampAbs(x - sx, space.w / 2), y);
        else if (e.key === "ArrowRight") onMove(clampAbs(x + sx, space.w / 2), y);
        else if (e.key === "ArrowUp") onMove(x, clampAbs(y + sy, space.h / 2));
        else if (e.key === "ArrowDown") onMove(x, clampAbs(y - sy, space.h / 2));
        else return;
        e.preventDefault();
      }}
      // self only: the z chip inside the box is its own control, and its focus
      // is not the box being reached
      {...hoverTip(tip, onTip, true)}
    >
      {hasDepth && (
        // the far face and the four edges running back to it: one wireframe
        // cube in one-point perspective, stroked at the capsule's own weight
        <svg className="posCube" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
          <rect
            x={INSET * 100}
            y={INSET * 100}
            width={100 - INSET * 200}
            height={100 - INSET * 200}
            vectorEffect="non-scaling-stroke"
          />
          <path
            d={`M0 0L${INSET * 100} ${INSET * 100}M100 0L${100 - INSET * 100} ${INSET * 100}M0 100L${INSET * 100} ${100 - INSET * 100}M100 100L${100 - INSET * 100} ${100 - INSET * 100}`}
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      )}
      {ring != null && (
        // the reach, as TWO radii: each diameter is mapped over its own extent,
        // the way the marker's position is. Out on the stage the reach is a
        // circle, so it comes out a circle in here whenever the box has the
        // stage's own ratio, and an oval exactly as far as the box is squashed
        // out of it. That oval is the truth: it is the dots this pocket really
        // reaches, drawn where they really are.
        <span
          className="posRing"
          style={{
            left: `${left}%`,
            top: `${top}%`,
            width: `${((ring * 2) / space.w) * span * 100}%`,
            height: `${((ring * 2) / space.h) * span * 100}%`,
            borderColor: tint,
          }}
          aria-hidden
        />
      )}
      <span
        className="posDot"
        style={{ left: `${left}%`, top: `${top}%`, width: dot, height: dot, borderColor: tint }}
        aria-hidden
      />
      {/* no depth to place, no depth controls: the chip and the readout are
          not there rather than sitting dead in the corner */}
      {hasDepth && (
        <>
          <button
            type="button"
            className={zOn ? "posMode on" : "posMode"}
            aria-pressed={zOn}
            // the visible letter leads the name, so speech input can say it
            aria-label="z, drag depth"
            title="Drag depth (or hold shift)"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => setZMode((v) => !v)}
          >
            z
          </button>
          <span className="posZ">{zLabel}</span>
        </>
      )}
      <span id={infoId} hidden>
        {tip}
      </span>
    </div>
  );
}

/* THE COLOR PICKER'S OWN MATH, in the two directions this control needs and no
 * others. HSV is what a saturation and value area over a hue slider IS, and
 * #rrggbb is what the tint props take, so the chip holds the first and sends
 * the second. */
type Hsv = { h: number; s: number; v: number };

const hex2 = (n: number) => Math.round(n * 255).toString(16).padStart(2, "0");

const toHex = ({ h, s, v }: Hsv) => {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return `#${hex2(f(5))}${hex2(f(3))}${hex2(f(1))}`;
};

const toHsv = (hex: string): Hsv => {
  const n = Number.parseInt(hex.slice(1), 16) || 0;
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const mx = Math.max(r, g, b);
  const d = mx - Math.min(r, g, b);
  const h =
    d === 0
      ? 0
      : mx === r
        ? 60 * (((g - b) / d + 6) % 6)
        : mx === g
          ? 60 * ((b - r) / d + 2)
          : 60 * ((r - g) / d + 4);
  return { h, s: mx === 0 ? 0 : d / mx, v: mx };
};

/** what the hex field accepts: three digits or six, with or without the hash.
 *  Anything else is someone mid-type, and nothing is sent. */
const readHex = (raw: string): string | null => {
  const t = raw.trim().replace(/^#/, "").toLowerCase();
  if (/^[0-9a-f]{3}$/.test(t)) return `#${t[0]}${t[0]}${t[1]}${t[1]}${t[2]}${t[2]}`;
  return /^[0-9a-f]{6}$/.test(t) ? `#${t}` : null;
};

/** how wide the picker's plate is: enough for a gradient worth aiming at and a
 *  hex under it, whatever the size of the chip it opens from. */
const PICK_W = 196;

/** one arrow press on the saturation and value area: a fortieth of the box, the
 *  locator's own step. */
const PICK_STEP = 0.025;

/* THE COLOR CHIP, and the picker behind it. The browser's own color control is
 * an operating system window that no page can style, so there is none here:
 * the chip is a button on the popover above, and the plate it opens is cut from
 * the menu's, down to the portal, the side, the dismissal and the focus.
 *
 * Three controls, which is what a color is: a saturation and value area under
 * the live hue, the hue itself, and the hex, the one place you type a color
 * instead of aiming at it. Every one of them COMMITS as it moves, so the cloud
 * answers the drag rather than the release.
 *
 * The chip holds the HSV, not the hex, and only reseeds from the hex when the
 * value moved without it: a drag down into black has no hue left in what it
 * sends, and reading it back would lose the one the pointer is still on. */
function ColorChip({
  value,
  live,
  name,
  side,
  describedBy,
  onChange,
  onTip,
}: {
  value: string;
  /** whether this half is the one reaching the canvas under the live theme */
  live: boolean;
  /** the whole accessible name: "light theme dot color" */
  name: string;
  side: Side;
  /** the card the capsule around this opens, so the chip points at it */
  describedBy: string;
  onChange: (v: string) => void;
  onTip: (tip: Tip | null) => void;
}) {
  const pop = usePop(side, PICK_W, () => onTip(null));
  const [hsv, setHsv] = useState(() => toHsv(value));
  const [text, setText] = useState(value);
  const sent = useRef(value);
  const sv = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (value.toLowerCase() === sent.current.toLowerCase()) return;
    sent.current = value;
    setHsv(toHsv(value));
    setText(value);
  }, [value]);

  /* every write goes through here, and it is the commit: the panel's value, the
   * hex field's text and the picker's own angle in one move */
  const put = (next: Hsv) => {
    const hex = toHex(next);
    setHsv(next);
    setText(hex);
    sent.current = hex;
    onChange(hex);
  };

  const at = (e: React.PointerEvent) => {
    const r = sv.current?.getBoundingClientRect();
    if (!r || r.width < 1 || r.height < 1) return;
    put({
      h: hsv.h,
      s: clamp01((e.clientX - r.left) / r.width),
      v: 1 - clamp01((e.clientY - r.top) / r.height),
    });
  };

  return (
    <>
      <button
        ref={pop.trig}
        type="button"
        className={live ? "swatch on" : "swatch"}
        style={{ background: value }}
        aria-haspopup="dialog"
        aria-expanded={pop.open}
        aria-label={name}
        aria-describedby={describedBy}
        onClick={pop.toggle}
      />
      {pop.open &&
        createPortal(
          <div
            ref={pop.panel}
            className="pick"
            role="dialog"
            aria-label={name}
            style={pop.style}
            onKeyDown={(e) => {
              // the three controls tab between themselves; a tab off either end
              // is the plate being left, so it closes and hands the focus back,
              // exactly the way the menu's does
              if (e.key !== "Tab") return;
              const t = e.target as HTMLElement;
              if (!t.classList.contains(e.shiftKey ? "pickSv" : "hex")) return;
              pop.close();
              pop.trig.current?.focus();
            }}
          >
            {/* the area, on the same keys the locator takes: a drag places it,
                the arrows nudge it a fortieth of the box at a time. It is the
                plate's landing spot, so a tab from here reaches the hue and the
                hex before it leaves. */}
            <div
              ref={sv}
              data-pop
              className="pickSv"
              style={{ "--hue": toHex({ h: hsv.h, s: 1, v: 1 }) } as React.CSSProperties}
              role="group"
              tabIndex={0}
              aria-label={`${name} saturation and value`}
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId);
                at(e);
              }}
              onPointerMove={(e) => {
                if (e.currentTarget.hasPointerCapture(e.pointerId)) at(e);
              }}
              onKeyDown={(e) => {
                if (e.key === "ArrowLeft") put({ ...hsv, s: clamp01(hsv.s - PICK_STEP) });
                else if (e.key === "ArrowRight") put({ ...hsv, s: clamp01(hsv.s + PICK_STEP) });
                else if (e.key === "ArrowUp") put({ ...hsv, v: clamp01(hsv.v + PICK_STEP) });
                else if (e.key === "ArrowDown") put({ ...hsv, v: clamp01(hsv.v - PICK_STEP) });
                else return;
                e.preventDefault();
              }}
            >
              <span
                className="pickDot"
                style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%` }}
                aria-hidden
              />
            </div>
            {/* the hue, on the capsule's own idea of a slider: a real range
                input stretched invisibly over the bar, everything visible above
                it and pointer events off */}
            <label className="hue" style={{ "--p": hsv.h / 360 } as React.CSSProperties}>
              <input
                type="range"
                min={0}
                max={360}
                step={1}
                value={Math.round(hsv.h)}
                aria-label={`${name} hue`}
                onChange={(e) => put({ ...hsv, h: Number(e.target.value) })}
              />
              <span className="hueThumb" aria-hidden />
            </label>
            <input
              className="hex"
              type="text"
              value={text}
              spellCheck={false}
              maxLength={7}
              aria-label={`${name} hex`}
              onChange={(e) => {
                setText(e.target.value);
                const hex = readHex(e.target.value);
                if (!hex) return;
                sent.current = hex;
                setHsv(toHsv(hex));
                onChange(hex);
              }}
              // a field left mid-type goes back to the color that is actually
              // live, rather than sitting there saying something else
              onBlur={() => setText(sent.current)}
            />
          </div>,
          document.body,
        )}
    </>
  );
}

/* THE COLOR PAIR, the one control every color in this panel wears: two chips as
 * the two halves of ONE pill, NAMED on their left, since which one is which is
 * the only thing two chips cannot say by themselves.
 *
 * Both values are kept and both stay editable whatever the page is set to; the
 * theme only SELECTS which one is live, marked by the lit chip. That is the
 * whole reason this is one component rather than two: the dots wear it and so
 * does every light pocket, so the two read identically and a color picked for
 * the light page survives a trip through the dark one either way.
 *
 * `name` is what these two color, and each chip's accessible name is built from
 * it, so four pockets and the dots never hand a screen reader six chips called
 * "color". */
function Swatches({
  light,
  dark,
  live,
  name,
  side,
  describedBy,
  onLight,
  onDark,
  onTip,
}: {
  light: string;
  dark: string;
  /** the RESOLVED theme, which marks the chip that is reaching the canvas */
  live: boolean;
  /** what the pair colors: "dot color", "spotlight 1 color" */
  name: string;
  /** which way each chip's picker opens: the card this pair lives in */
  side: Side;
  /** the card the capsule around this opens, so both chips point at it */
  describedBy: string;
  onLight: (v: string) => void;
  onDark: (v: string) => void;
  onTip: (tip: Tip | null) => void;
}) {
  return (
    <span className="swatches">
      <span className="swatchNames" aria-hidden>
        light / dark
      </span>
      <span className="swatchPair">
        {(
          [
            ["light", light, onLight],
            ["dark", dark, onDark],
          ] as const
        ).map(([theme, value, onChange]) => (
          <ColorChip
            key={theme}
            value={value}
            live={(theme === "dark") === live}
            name={`${theme} theme ${name}`}
            side={side}
            describedBy={describedBy}
            onChange={onChange}
            onTip={onTip}
          />
        ))}
      </span>
    </span>
  );
}

export default function Controls({
  cfg,
  set,
  dark,
  world,
  onPulse,
  onPulseOn,
  onUpload,
  voice,
  voiceName,
  voiceOn,
  onVoice,
  onVoiceRun,
  onVoiceFile,
}: {
  cfg: Config;
  set: <K extends keyof Config>(k: K, v: Config[K]) => void;
  /** the RESOLVED theme, since "system" is only an answer once the media query
   *  is read. It marks which dot color is live. */
  dark: boolean;
  /** the stage's visible world extents, so a locator can place a pocket in the
   *  same units the hook returns */
  world: { w: number; h: number };
  onPulse: (v: PulseType) => void;
  /** the pulsation section's switch: it starts and stops the transport, so it
   *  runs through the same handler the type menu does */
  onPulseOn: (on: boolean) => void;
  onUpload: (f: File) => void;
  /** the face's live voice source, and the same three things every source
   *  menu here needs: what it is called, whether it is running, and the two
   *  handlers that pick one and start or stop it */
  voice: VoiceId;
  voiceName: string | null;
  voiceOn: boolean;
  onVoice: (v: VoiceId) => void;
  onVoiceRun: (on: boolean) => void;
  onVoiceFile: (f: File) => void;
}) {
  const [tip, setTip] = useState<Tip | null>(null);
  /* COPY CONFIG: the whole Config, pretty printed, onto the clipboard. The
   * panel IS this object at its real ranges, so the copy is the recipe of the
   * nebula on screen: paste it into an issue, a message or a host's own state
   * and every number means what the dial said. The check is the confirmation,
   * worn for a moment in place of the mark; a refused clipboard (a permissions
   * policy) simply never confirms, rather than pretending it did. */
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (copyTimer.current != null) window.clearTimeout(copyTimer.current);
    },
    [],
  );
  const onCopy = () => {
    void navigator.clipboard
      ?.writeText(JSON.stringify(cfg, null, 2))
      .then(() => {
        setCopied(true);
        if (copyTimer.current != null) window.clearTimeout(copyTimer.current);
        copyTimer.current = window.setTimeout(() => setCopied(false), 1400);
      })
      .catch(() => {});
  };
  const faceOn = cfg.formation === "face";
  // the two gates the panel hides on. A VOLUME takes the build dials and turns
  // under a drag; a volume with a FRONT also follows the cursor, which the two
  // viewport volumes cannot do.
  const spatial = SPATIAL.has(cfg.formation);
  const oriented = ORIENTED.has(cfg.formation);
  const spots = cfg.spotlights;
  const source = sourceById(cfg.pulseType);
  const uploaded = uploadName();
  /* What the pulsation section offers, which is a question about the source
   * the menu is SHOWING and not about whether it is running: the section is
   * open in both states (the transport, at the top of this file), so these two
   * follow the menu the way the three reach dials do.
   *
   * `audible` is real audio, which is what the volume dial levels: the
   * metronome is the demo's own clock and makes no sound. `hasTempo` is
   * anything with a tempo to set, which is that same clock and a synthesized
   * pattern; a recorded track carries its own. */
  const audible = source != null;
  const hasTempo = cfg.pulseType === "beat" || source?.kind === "synth";
  // the locator's shape: the stage's own, held inside the band the panel can
  // lay out (BOX_MIN_ASPECT, where the whole of this is written out)
  const aspect = Math.max(BOX_MIN_ASPECT, Math.min(BOX_MAX_ASPECT, world.w / world.h));

  // the spotlights are one array, so a block's dials write one pocket at a time
  const setSpot = (i: number, patch: Partial<SpotCfg>) =>
    set(
      "spotlights",
      spots.map((s, j) => (j === i ? { ...s, ...patch } : s)),
    );
  const pick = (v: string) => set("formation", v);

  const typeLabel =
    cfg.pulseType === "beat"
      ? "Metronome"
      : cfg.pulseType === UPLOAD_ID
        ? (uploaded ?? "Your file")
        : (source?.label ?? "Metronome");
  const typeGroups: MenuGroup[] = [
    { label: "Beating", items: [{ value: "beat", label: "Metronome" }] },
    { label: "Sample beats", items: SYNTHS.map((s) => ({ value: s.id, label: s.label })) },
    { label: "Soundtracks", items: TRACKS.map((s) => ({ value: s.id, label: s.label })) },
    {
      label: "Your file",
      items: uploaded ? [{ value: UPLOAD_ID, label: uploaded }] : [],
      pick: { label: uploaded ? "Choose another" : "Choose a file", onFile: onUpload },
    },
  ];

  /* THE FACE'S VOICE, behind the SAME capsule and the same grouped menu the
   * soundtrack sits behind, because it is the same question. It is not the same
   * ANSWER: the voice drives the face's own analyser and the soundtrack drives
   * the field's, so the two source lists are separate and the music is never
   * offered here. Three groups: the simulation, which is amplitude pushed
   * straight in with no audio at all, the bundled speech in voices.ts, and
   * whatever the user hands it. */
  const voiceLabel =
    voice === VOICE_UPLOAD
      ? (voiceName ?? "Your file")
      : (VOICE_CLIPS.find((c) => c.id === voice)?.label ?? "Agent stream");
  const voiceGroups: MenuGroup[] = [
    { label: "Simulation", items: [{ value: VOICE_SIM, label: "Agent stream" }] },
    {
      label: "Samples",
      items: VOICE_CLIPS.map((c) => ({ value: c.id, label: c.label })),
    },
    {
      label: "Upload",
      items: voiceName ? [{ value: VOICE_UPLOAD, label: voiceName }] : [],
      pick: { label: voiceName ? "Choose another" : "Choose a file", onFile: onVoiceFile },
    },
  ];

  return (
    /* the rail is nothing on a wide screen, where each card places itself
       against a viewport edge, and the single scrolling column below the
       breakpoint. Either way the picker comes first: it is the choice the rest
       of the panel is about. */
    <div className="rail">
      {/* the hover card, and the SEEN half of the copy only: every control here
          already points at its own hidden copy with aria-describedby, so this
          one is hidden from the tree rather than read out a second time. */}
      {tip && (
        <div
          className={tip.near === "picker" ? "infotip picker" : "infotip"}
          style={{ top: Math.min(Math.max(tip.y, 60), window.innerHeight - 60) }}
          aria-hidden
        >
          {tip.text}
        </div>
      )}

      <section className="card picker" aria-label="Formations">
        <div className="pickBody" onScroll={() => setTip(null)}>
          <Section title="2D" tipKey="s 2d" onTip={setTip} />
          <Pills label="2D formations" options={FLAT} value={cfg.formation} onChange={pick} />
          <Section title="3D" tipKey="s 3d" onTip={setTip} />
          <Pills label="3D formations" options={SOLIDS} value={cfg.formation} onChange={pick} />
          <Section title="Face" tipKey="s face" onTip={setTip} />
          {/* the face's pill and its TRANSPORT on one line. The transport is
              the panel's own section switch in its played drawing, the one the
              pulsation section wears: one glyph and no word, starting and
              stopping whatever the menu below is showing, lit while that is
              speaking, and saying which in words to a screen reader. It rides
              the pill because that is what it is about, and it folds away with
              it. */}
          <div className="faceRow">
            <Pills label="Face formation" options={FACE} value={cfg.formation} onChange={pick} />
            <Fold open={faceOn}>
              <Toggle on={voiceOn} name="voice" play onTip={setTip} onToggle={onVoiceRun} />
            </Fold>
          </div>
          {/* the rest of the face's controls, under the face itself: they are
              about the formation that is on screen, so they live with the
              choice rather than in a settings card that is about everything
              else. They fold in and out with it, the way everything that stops
              applying does. */}
          <Fold open={faceOn}>
            <div className="faceBlock">
              {/* the source. It sits in the LEFT card, so its plate opens
                  BESIDE the trigger, out over the canvas, which keeps the
                  controls under it in view while it is open */}
              <Menu
                label="voice"
                value={voice}
                valueLabel={voiceLabel}
                groups={voiceGroups}
                side="beside"
                onChange={(v) => onVoice(v as VoiceId)}
                onTip={setTip}
              />
              {/* how loud that source plays, and the face's own: it lands on
                  the element the face listens to, never on the soundtrack's
                  master (app.tsx). It goes the way the soundtrack's volume goes
                  on the metronome: the simulation pushes amplitude and makes no
                  sound, so there is nothing to level and the dial is not there.
                  Nothing is playing then either, so the number it was left on
                  reaches no ear. */}
              <Fold open={voice !== VOICE_SIM}>
                <Slider
                  label="voice volume"
                  value={cfg.voiceVolume}
                  onChange={(v) => set("voiceVolume", v)}
                  onTip={setTip}
                />
              </Fold>
              <Slider
                label="modulation"
                value={cfg.faceMod}
                onChange={(v) => set("faceMod", v)}
                onTip={setTip}
              />
              <Slider
                label="blink"
                value={cfg.faceBlink}
                onChange={(v) => set("faceBlink", v)}
                onTip={setTip}
              />
            </div>
          </Fold>
        </div>
      </section>

      <aside className="card panel" aria-label="Settings" onScroll={() => setTip(null)}>
        <header className="panelHead">
          <h1>Nebula</h1>
          <div className="headTools">
            {/* the recipe of the nebula on screen, one click to the clipboard;
                the mark wears a check while the copy is confirmed */}
            <button
              type="button"
              className="iconBtn"
              title="Copy this configuration as JSON"
              aria-label="Copy this configuration as JSON"
              onClick={onCopy}
            >
              <Icon>
                {copied ? (
                  <path d="M20 6 9 17l-5-5" />
                ) : (
                  <>
                    <rect x="9" y="9" width="13" height="13" rx="2" />
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                  </>
                )}
              </Icon>
            </button>
            {/* the confirmation, said as well as drawn: the check is an
                aria-hidden glyph, so the announcement is this status region,
                which a screen reader speaks when the text arrives */}
            <span role="status" className="srOnly">
              {copied ? "Configuration copied" : ""}
            </span>
            <button
              type="button"
              className="iconBtn"
              title={`Switch to the ${NEXT_THEME[cfg.theme]} theme`}
              aria-label={`Switch to the ${NEXT_THEME[cfg.theme]} theme`}
              onClick={() => set("theme", NEXT_THEME[cfg.theme])}
            >
              <ThemeIcon theme={cfg.theme} />
            </button>
            <a
              className="gh"
              href="https://github.com/0backlog/nebula"
              target="_blank"
              rel="noreferrer"
              aria-label="Nebula on GitHub"
            >
              <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden>
                <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
              </svg>
            </a>
          </div>
        </header>
        <p className="intro">
          Nebula is a versatile component for an omnipresent, shape shifting presence. Highly
          configurable, fast, and open source. Built to escape the generic look of the agentic era.
        </p>

        {/* THE ORDER of what follows is the order the owner reads the demo in:
            the build first, then the mark, then what a pointer does to it, then
            where it all sits, then how it is lit, and the music last. Two
            sections are not free to move: Formation is first because it is the
            build the picker just chose, and Orientation follows Space because
            both are about where the cloud is rather than what it is made of. */}

        {/* Every control here belongs to a VOLUME: scale and diffusion are its
            two build inputs, and spin is how it answers a drag. A flat field
            has no radius, no surface and no front, so the whole section folds
            away, heading included. */}
        <Fold open={spatial}>
          <Section title="Formation" tipKey="s formation" onTip={setTip} />
          <Slider label="scale" value={cfg.scale} onChange={(v) => set("scale", v)} onTip={setTip} />
          <Slider label="spin" value={cfg.spin} onChange={(v) => set("spin", v)} onTip={setTip} />
          <Slider label="diffusion" value={cfg.diffusion} onChange={(v) => set("diffusion", v)} onTip={setTip} />
        </Fold>

        <Section title="Dots" tipKey="s dots" onTip={setTip} />
        {/* the count is a dial like everything else; the real number is in the
            card, and the phone's share of it sits right under it */}
        <Slider
          label="count"
          value={cfg.points}
          onChange={(v) => set("points", v)}
          tip={`How many points are drawn: ${pointsAt(cfg.points)} of the ${CAPACITY} the buffer holds. A change morphs the cloud in place rather than remounting it.`}
          onTip={setTip}
        />
        <Slider label="mobile reduction" value={cfg.mobile} onChange={(v) => set("mobile", v)} onTip={setTip} />
        <Slider label="size" value={cfg.size} onChange={(v) => set("size", v)} onTip={setTip} />
        <Slider label="chaos" value={cfg.chaos} onChange={(v) => set("chaos", v)} onTip={setTip} />
        {/* rounding goes last of the dots: it is the one that changes the MARK
            rather than the field, and it is the one nobody moves twice */}
        <Slider label="rounding" value={cfg.round} onChange={(v) => set("round", v)} onTip={setTip} />

        <Section
          title="Cursor"
          tipKey="s cursor"
          onTip={setTip}
          on={cfg.cursorOn}
          onToggle={(v) => set("cursorOn", v)}
        >
          {/* the effects sit bare: a label column beside a wrapping row of
              pills only bent the column out of line, and the card they carry
              comes off the row itself */}
          <Pills
            options={MODES.map((m) => ({ value: m, label: m }))}
            value={cfg.mode}
            onChange={(v) => set("mode", v as FieldCursorMode)}
            label="cursor effect"
            tip={TIPS.effect}
            onTip={setTip}
          />
          <Slider label="radius" value={cfg.reach} onChange={(v) => set("reach", v)} onTip={setTip} />
          <Slider label="strength" value={cfg.force} onChange={(v) => set("force", v)} onTip={setTip} />
          <Slider label="trail" value={cfg.trail} onChange={(v) => set("trail", v)} onTip={setTip} />
        </Section>

        <Section title="Space" tipKey="s space" onTip={setTip} />
        <Slider label="move" value={cfg.parallax} onChange={(v) => set("parallax", v)} onTip={setTip} />
        <Slider label="bend" value={cfg.bend} onChange={(v) => set("bend", v)} onTip={setTip} />

        {/* the orientation is three dials over one payload: two the demo works
            out on the target it feeds the hook, one the payload carries itself.
            They are a section of their own now, so none of them has to repeat
            the word in its label, and the three of them fold away together on
            anything with no front to turn. It sits immediately under Space
            because it is the same subject: where the cloud is pointed. */}
        <Fold open={oriented}>
          <Section title="Orientation" tipKey="s orientation" onTip={setTip} />
          <Slider label="amplitude" value={cfg.lookAmp} onChange={(v) => set("lookAmp", v)} onTip={setTip} />
          <Slider label="speed" value={cfg.look} onChange={(v) => set("look", v)} onTip={setTip} />
          <Slider label="delay" value={cfg.lookLag} onChange={(v) => set("lookLag", v)} onTip={setTip} />
        </Fold>

        {/* the dots' own color leads this section: what color they are is a
            question about the light, and the pockets below answer the same one
            for the parts of the cloud they fall on. It is two values at once,
            on the pair control every pocket wears: the theme selects the live
            one and leaves the other as it was. */}
        <Section title="Light" tipKey="s light" onTip={setTip} />
        <Cap label="color" onTip={setTip}>
          {(id) => (
            <Swatches
              light={cfg.tintLight}
              dark={cfg.tintDark}
              live={dark}
              name="dot color"
              /* the settings card, so each chip's picker opens leftward */
              side="left"
              describedBy={id}
              onLight={(v) => set("tintLight", v)}
              onDark={(v) => set("tintDark", v)}
              onTip={setTip}
            />
          )}
        </Cap>
        <Slider label="brightness" value={cfg.intensity} onChange={(v) => set("intensity", v)} onTip={setTip} />
        <Slider label="shine" value={cfg.shine} onChange={(v) => set("shine", v)} onTip={setTip} />
        <Slider label="additive" value={cfg.additive} onChange={(v) => set("additive", v)} onTip={setTip} />

        {/* the pockets. The heading carries the + because that is the one
            control that belongs to the LIST rather than to any one pocket, and
            the switch because a section that can be off says so on its own
            line. */}
        <Section
          title="Spotlights"
          tipKey="s spotlights"
          onTip={setTip}
          on={cfg.spotsOn}
          onToggle={(v) => set("spotsOn", v)}
          /* the + goes once there is nothing left to add: the engine honors
             four pockets, and a button that cannot do its job is not there */
          action={
            cfg.spotsOn && spots.length < SPOT_MAX ? (
              <button
                type="button"
                className="iconBtn"
                title="Add a light pocket"
                aria-label="Add a light pocket"
                onClick={() => set("spotlights", [...spots, newSpot(spots.length, world)])}
              >
                <Icon size={15}>
                  <path d="M12 5v14M5 12h14" />
                </Icon>
              </button>
            ) : undefined
          }
        >
          {spots.map((s, i) => {
            const n = i + 1;
            // the locator's marker wears the color the ENGINE is being handed,
            // which is the theme's own half of the pair
            const tinted = s.tintOn ? (dark ? s.tintDark : s.tintLight) : undefined;
            // the pocket is placed in depth only where there is depth to place it
            const deep = oriented && s.depth;
            return (
              <div className="block" key={s.id}>
                <Section
                  title={`Spotlight ${n}`}
                  tipKey="s spotlight"
                  onTip={setTip}
                  sub
                  on={s.on}
                  onToggle={(v) => setSpot(i, { on: v })}
                  toggleName={`spotlight ${n}`}
                  action={
                    <button
                      type="button"
                      className="iconBtn"
                      title="Remove"
                      // four of these ride at once, so the name carries the
                      // pocket the same way every other repeated control does
                      aria-label={`Remove spotlight ${n}`}
                      onClick={() =>
                        set(
                          "spotlights",
                          spots.filter((_, j) => j !== i),
                        )
                      }
                    >
                      <Icon size={14}>
                        <path d="M18 6 6 18M6 6l12 12" />
                      </Icon>
                    </button>
                  }
                >
                  {/* the color PAIR, the dots' own control down to its
                      "light / dark" label, and the switch that decides whether
                      the prop is passed at all: off is undefined, which is the
                      pocket that only brightens. Both colors are kept and both
                      stay editable; the theme selects which one reaches the
                      engine. Picking either turns the switch back on, since a
                      swatch you can edit and not see is a dead end. */}
                  <Cap label="color" tip={TIPS["spotlight color"]} onTip={setTip}>
                    {(id) => (
                      <span className="spotColor">
                        <Swatches
                          light={s.tintLight}
                          dark={s.tintDark}
                          live={dark}
                          name={`spotlight ${n} color`}
                          side="left"
                          describedBy={id}
                          onLight={(v) => setSpot(i, { tintLight: v, tintOn: true })}
                          onDark={(v) => setSpot(i, { tintDark: v, tintOn: true })}
                          onTip={setTip}
                        />
                        <button
                          type="button"
                          className={s.tintOn ? "capAct on" : "capAct"}
                          aria-pressed={s.tintOn}
                          // the chip's own word first, then which pocket it is
                          aria-label={
                            s.tintOn
                              ? `On, turn spotlight ${n} color off`
                              : `Off, turn spotlight ${n} color on`
                          }
                          aria-describedby={id}
                          onClick={() => setSpot(i, { tintOn: !s.tintOn })}
                        >
                          {s.tintOn ? "On" : "Off"}
                        </button>
                      </span>
                    )}
                  </Cap>
                  <Slider
                    label="intensity"
                    name={`spotlight ${n} intensity`}
                    tip={TIPS["spotlight intensity"]}
                    value={s.intensity}
                    onChange={(v) => setSpot(i, { intensity: v })}
                    onTip={setTip}
                  />
                  <Slider
                    label="radius"
                    name={`spotlight ${n} radius`}
                    tip={TIPS["spotlight radius"]}
                    value={s.radius}
                    onChange={(v) => setSpot(i, { radius: v })}
                    onTip={setTip}
                  />
                  {/* the third axis is offered, not assumed: a flat formation
                      has no depth to place a pocket in, so the choice is not
                      there at all and the box below is two axes */}
                  <Fold open={oriented}>
                    <Cap label="position" tip={TIPS["spotlight position"]} onTip={setTip}>
                      {(id) => (
                        <span className="segs">
                          <button
                            type="button"
                            className={deep ? "capAct" : "capAct on"}
                            aria-pressed={!deep}
                            aria-label={`2D, place spotlight ${n} on the plane`}
                            aria-describedby={id}
                            onClick={() => setSpot(i, { depth: false })}
                          >
                            2D
                          </button>
                          <button
                            type="button"
                            className={deep ? "capAct on" : "capAct"}
                            aria-pressed={deep}
                            aria-label={`3D, place spotlight ${n} in depth`}
                            aria-describedby={id}
                            onClick={() => setSpot(i, { depth: true })}
                          >
                            3D
                          </button>
                        </span>
                      )}
                    </Cap>
                  </Fold>
                  <Locator
                    label={`spotlight ${n} position`}
                    tip={TIPS["spotlight position"]}
                    x={s.x}
                    y={s.y}
                    zt={s.z / 10}
                    space={world}
                    aspect={aspect}
                    // the ring is the pocket's real reach, resolved the way
                    // the engine resolves the dial
                    ring={dial10(s.radius, 0.2, 1.1, 3)}
                    tint={tinted}
                    hasDepth={deep}
                    zLabel={s.z.toFixed(1)}
                    onMove={(x, y) => setSpot(i, { x, y })}
                    onDepth={(t) => setSpot(i, { z: Math.round(t * 100) / 10 })}
                    onTip={setTip}
                  />
                </Section>
              </div>
            );
          })}
        </Section>

        <Section title="Transitions" tipKey="s transitions" onTip={setTip} />
        <Slider label="transition speed" value={cfg.transition} onChange={(v) => set("transition", v)} onTip={setTip} />
        <Slider label="shuffle" value={cfg.shuffle} onChange={(v) => set("shuffle", v)} onTip={setTip} />

        {/* THE ONE SECTION whose switch is a transport: what it turns on is
            something PLAYING, so it wears the face's own play and pause rather
            than the word chip, and pausing leaves every control below it on
            screen and live. That is this panel's one exception to hide, never
            dim, and it is the right one: what is in here is what a person sets
            before pressing play. Paused, nothing is playing and app.tsx
            resolves the three sends to 0, so the cloud is left alone. */}
        <Section
          title="Pulsation"
          tipKey="s pulsation"
          onTip={setTip}
          on={cfg.pulseOn}
          onToggle={onPulseOn}
          transport
        >
          <Menu
            label="type"
            value={cfg.pulseType}
            valueLabel={typeLabel}
            groups={typeGroups}
            /* the settings card, so this one keeps opening leftward */
            side="left"
            onChange={(v) => onPulse(v as PulseType)}
            onTip={setTip}
          />
          {/* bpm is a real tempo, not a dial, and it is only there where there
              is a tempo to set: a recorded track carries its own. The volume
              goes the same way, since the metronome makes no sound to level.
              Both are about the source above them rather than about the
              transport, so a paused section still offers whichever of them the
              menu's own choice has: play starts on the tempo showing here
              (app.tsx) and at the level showing here. */}
          <Fold open={hasTempo}>
            <Slider label="bpm" value={cfg.bpm} min={60} max={170} step={1} digits={0} onChange={(v) => set("bpm", v)} onTip={setTip} />
          </Fold>
          <Fold open={audible}>
            <Slider label="volume" value={cfg.volume} onChange={(v) => set("volume", v)} onTip={setTip} />
          </Fold>

          {/* the sends, on the section's own flat list rather than behind a sub
              heading of their own: they are the other half of the same
              question, and what a source is FOR is where it lands. One dial per
              aspect the signal reaches, each adding to that aspect's own value
              rather than replacing it, and named for how far the music REACHES
              into it, since nothing here transforms anything: send is the
              code's word. */}
          <Slider label="pulse reach" value={cfg.sendPulse} onChange={(v) => set("sendPulse", v)} onTip={setTip} />
          <Slider label="chaos reach" value={cfg.sendChaos} onChange={(v) => set("sendChaos", v)} onTip={setTip} />
          <Slider label="brightness reach" value={cfg.sendBright} onChange={(v) => set("sendBright", v)} onTip={setTip} />
        </Section>
      </aside>
    </div>
  );
}
