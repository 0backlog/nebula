import {
  useCallback,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  attachFaceAudio,
  cloudFormation,
  composedFormation,
  curtainFormation,
  dial10,
  dnaFormation,
  DsField,
  faceFormation,
  FIELD_CAMERA,
  flowerFormation,
  geometryFormation,
  horizonFormation,
  hourglassFormation,
  latticeFormation,
  resumeFaceAudio,
  setFaceDrive,
  setFaceGesture,
  clearFaceDrive,
  streamFormation,
  veinsFormation,
  type FieldFormation,
  type FieldSpotlight,
} from "@0backlog/nebula";
import Controls, {
  CAPACITY,
  type Config,
  DEFAULTS,
  INTENSITY_DARK,
  INTENSITY_LIGHT,
  ORIENTED,
  pointsAt,
  type PulseType,
  SPATIAL,
  SPOT_MAX,
  VOICE_SIM,
  VOICE_UPLOAD,
  type VoiceId,
} from "./controls";
import {
  ATOM_PARTS,
  BITCOIN_PARTS,
  CAPSULE_GEO,
  CUBE_GEO,
  DIAMOND_GEO,
  DODECA_GEO,
  GALAXY_PARTS,
  HOURGLASS_PARTS,
  ICOSA_GEO,
  KNOT_GEO,
  MOBIUS_GEO,
  OCTA_GEO,
  PYRAMID_GEO,
  RING_PARTS,
  ROSE_PARTS,
  SATURN_PARTS,
  SPHERE_GEO,
  SPRING_GEO,
  TORNADO_PARTS,
  TORUS_GEO,
} from "./shapes";
import { pulse } from "./energy";
import { Credits } from "./credits";
import { voiceClipFile } from "./voices";
import {
  loadUpload,
  onSounding,
  playSource,
  sampleAudio,
  setVolume,
  SOUNDTRACK_SOURCES,
  sourceById,
  stopSource,
  UPLOAD_ID,
} from "./soundtrack";

/* The demo. It exists to be read as much as run: every control maps to one
 * DsField prop, one FieldFormation field, one host hook's payload, or one
 * face dial, at its real range. And that range is almost always the same one,
 * because the public API is 0..10 dials with 5 as the tuned nominal. Exactly
 * one number here is a real unit: the bpm.
 *
 * One rule shapes the whole file: nothing that changes per frame or per drag
 * goes through a prop that would rebuild the formations. The energy, gather,
 * orient and spotlights hooks read refs and write into buffers they allocated
 * once; the personality knobs (size, chaos, reach, force) MUTATE the registry's
 * formation objects, which the engine reads live each frame. Only true BUILD
 * inputs rebuild the registry: the point count, the scale and the diffusion,
 * all of which are baked into the point positions themselves.
 *
 * A second rule answers the panel: a control the panel has HIDDEN reaches the
 * engine as its neutral value, never as the number it was left on. The cursor
 * section off passes mode "off" and trail 0, the spotlights off pass an empty
 * list, the pulsation off resolves every send to 0, and a flat formation gets
 * spin 0 and none of the volume build inputs.
 *
 * The audio follows the same rule. sampleAudio runs ONCE a frame, inside the
 * energy callback, and every send is applied from there: the chaos and the
 * brightness onto the formation objects, the pulse as the number energy itself
 * returns. The music moves the cloud without a single render.
 *
 * The layout is one canvas and two floating cards over it, so the field is
 * full bleed and nothing crops it. That costs exactly two things here, and
 * both are the same fact twice: the cards have to be subtracted from the
 * pointer zone, since the stage's own rect runs underneath them, and they have
 * to be subtracted from the SAFE AREA, since the middle of the canvas is not
 * the middle of what a person sees. */

/* the visible world at z = 0, straight off the shared camera numbers. gather,
 * the light pockets and the panel's locators all speak this space, so the
 * screen-to-world mapping lives here once. */
const WORLD_H = 2 * FIELD_CAMERA.z * Math.tan((FIELD_CAMERA.fov * Math.PI) / 360);

/* how many frames of pointer path the orientation delay can read back through.
 * 128 covers the longest lag the dial offers even on a 144Hz screen. */
const LOOK_N = 128;

/* Each synthesized pattern's NOMINAL tempo, read once at load, before anything
 * here writes one. The bpm dial drives those patterns too (see the tempo effect
 * below), and it writes the tempo onto the source descriptor, so the number the
 * pattern shipped with has to be kept somewhere it cannot be overwritten. */
const SYNTH_BPM = new Map(
  SOUNDTRACK_SOURCES.filter((s) => s.kind === "synth").map((s) => [s.id, s.bpm ?? 120]),
);

/** what the bpm dial should read for a source just picked from the menu: the
 *  demo's own tempo for the metronome, a synthesized pattern's own nominal, and
 *  null for a recorded track, which carries a tempo nothing here can set. */
const nominalBpm = (v: PulseType) => {
  const src = sourceById(v);
  if (!src) return DEFAULTS.bpm;
  return src.kind === "synth" ? (SYNTH_BPM.get(src.id) ?? DEFAULTS.bpm) : null;
};

/* how long the bpm dial waits before it restarts a synthesized pattern. The
 * transport takes its tempo when it starts and never again, so moving the dial
 * has to stop and start it; doing that per pointer event would stutter, so it
 * lands once the drag has settled. */
const TEMPO_SETTLE_MS = 220;

/* no pockets at all, for a spotlights section switched off. One frozen array
 * rather than a fresh one per render, since the hook reads it every frame. */
const NO_SPOTS: Config["spotlights"] = [];

/* the gather and orient payloads, allocated once and rewritten in place, the
 * way the spotlight buffers are: both hooks run every frame, and the engine
 * reads the numbers out inside that frame and keeps nothing.
 *
 * gather's r is the falloff spread, and the one field on either payload that is
 * a raw multiplier rather than a dial. 1.6 is the engine's own whole-page
 * default, written out here so the payload shows every field the demo relies
 * on rather than leaving one of them implied. */
const GATHER_OUT = { x: 0, y: 0, r: 1.6, s: 0 };
const ORIENT_OUT = { rx: 0, ry: 0, speed: 0 };

/** the safe area, in css px, exactly as the engine takes it. */
type Inset = { left: number; right: number; top: number; bottom: number };

const NO_INSET: Inset = { left: 0, right: 0, top: 0, bottom: 0 };

/* What the floating cards take off the stage. Each card is MEASURED against
 * the stage rather than read off the stylesheet, so one rule answers for every
 * arrangement: a card that overlaps the stage is subtracted from the side it
 * hugs (the side it covers least of), and a card that overlaps nothing
 * subtracts nothing. On a wide screen that is the picker on the left and the
 * settings on the right; below the breakpoint the cards sit under the stage in
 * their own rail, overlap it nowhere, and every inset is 0. A card that came up
 * over the bottom of the stage would land on `bottom` with no code of its
 * own. */
function insetOf(stage: DOMRect, cards: HTMLCollectionOf<Element>): Inset {
  const out: Inset = { left: 0, right: 0, top: 0, bottom: 0 };
  for (let i = 0; i < cards.length; i++) {
    const r = cards[i].getBoundingClientRect();
    if (r.right <= stage.left || r.left >= stage.right) continue;
    if (r.bottom <= stage.top || r.top >= stage.bottom) continue;
    // how much of the stage this card would cost, read from each side in turn.
    // The smallest is the side it actually sits against.
    const left = r.right - stage.left;
    const right = stage.right - r.left;
    const top = r.bottom - stage.top;
    const bottom = stage.bottom - r.top;
    // compared as a FRACTION of the stage on each axis, since px across a wide
    // stage and px down a short one are not the same cost: on a 1200x340 window
    // the settings card's top overlap is the smallest number of pixels and 96%
    // of the height, and the cloud would be booked into the strip under it
    const fl = left / stage.width;
    const fr = right / stage.width;
    const ft = top / stage.height;
    const fb = bottom / stage.height;
    const min = Math.min(fl, fr, ft, fb);
    if (min <= 0) continue;
    if (min === fl) out.left = Math.max(out.left, left);
    else if (min === fr) out.right = Math.max(out.right, right);
    else if (min === ft) out.top = Math.max(out.top, top);
    else out.bottom = Math.max(out.bottom, bottom);
  }
  return out;
}

const sameInset = (a: Inset, b: Inset) =>
  a.left === b.left && a.right === b.right && a.top === b.top && a.bottom === b.bottom;

export default function App() {
  const [cfg, setCfg] = useState<Config>(DEFAULTS);
  const set = <K extends keyof Config>(k: K, v: Config[K]) =>
    setCfg((c) => ({ ...c, [k]: v }));
  const cfgRef = useRef(cfg);

  /* Theme. data-theme on <html> drives the palette (styles.css resolves
   * "system" through prefers-color-scheme, and so does this effect, because
   * the canvas needs the answer as a value). The resolved light or dark then
   * SELECTS the live tint, one of the two the config carries, and RESETS the
   * presence dial (the intensity prop), because those dark dots need close to
   * twice the presence to read the same (see INTENSITY_LIGHT). The tint is two
   * values so editing either survives a theme switch; the presence is one, so
   * the theme owns it again on every switch and the dial owns it in between. */
  const [dark, setDark] = useState(DEFAULTS.theme !== "light");
  useEffect(() => {
    const theme = cfg.theme;
    document.documentElement.dataset.theme = theme;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const sync = () => {
      const isDark = theme === "system" ? mq.matches : theme === "dark";
      setDark(isDark);
      // the RESOLVED theme owns the dial, so a resolved theme that did not move
      // must leave it alone: an OS appearance change under an explicit dark or
      // light page changes nothing on screen, and it cannot put the dial back
      const want = isDark ? INTENSITY_DARK : INTENSITY_LIGHT;
      setCfg((c) => (c.intensity === want ? c : { ...c, intensity: want }));
    };
    sync();
    // "system" is the one theme whose answer can change without this effect
    // running again, so it is the only one that needs the media query
    if (theme !== "system") return;
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, [cfg.theme]);
  const tint = dark ? cfg.tintDark : cfg.tintLight;

  /* The formation registry. It rebuilds only on BUILD inputs: the point count
   * (the buffer is CAPACITY, so a count change MORPHS instead of remounting),
   * the scale and the diffusion, which are geometry baked into the positions.
   * It builds at the CURRENT personality, read through a ref so the memo stays
   * keyed on those three alone: mount and rebuilds start at the live look
   * instead of easing in from the engine defaults; the mutation effect below
   * keeps scrubbing live between rebuilds. That ref holds the last COMMITTED
   * config (see the layout effect below), so a background render builds against
   * what the engine actually has. All three are DEFERRED, so a drag paints the
   * slider first and resamples the shape when React next gets a breath, instead
   * of once per pointer event. */
  const points = useDeferredValue(cfg.points);
  const count = pointsAt(points);
  const scale = useDeferredValue(cfg.scale);
  const diffusion = useDeferredValue(cfg.diffusion);
  const formations = useMemo<Record<string, FieldFormation>>(() => {
    const { size, chaos, reach, force } = cfgRef.current;
    const p = { size, chaos, cursorReach: reach, cursorForce: force };
    // the scale dial is a MULTIPLIER on each formation's own nominal radius,
    // resolved through the library's own dial10, so 5 lands exactly on the
    // radius it ships with and 10 doubles it
    const k = dial10(scale, 0.25, 1, 2);
    /* THE 3D BUILD, one call for every formation the picker groups as a
     * volume: its own nominal radius times the scale dial, the diffusion dial
     * passed straight through (it is the one build input about how the points
     * meet the surface rather than where the surface is), and its own resting
     * opacity. The flat fields take neither, which is exactly why the panel
     * hides both dials on them. */
    const solid = (radius = 2.2, opacity = 0.36) => ({
      count,
      radius: radius * k,
      diffusion,
      opacity,
      ...p,
    });
    return {
      "curtain-still": curtainFormation({ count, opacity: 0.3, ...p }),
      "curtain-down": curtainFormation({ count, flow: "down", opacity: 0.3, ...p }),
      "curtain-right": curtainFormation({ count, flow: "right", opacity: 0.3, ...p }),
      lattice: latticeFormation({ count, opacity: 0.24, ...p }),
      cloud: cloudFormation({ count, opacity: 0.24, ...p }),
      stream: streamFormation({ count, opacity: 0.3, ...p }),
      // the sand timer as a field: two bells and the fall through the waist
      // between them. Flat like the rest of this group, so it takes neither
      // build dial. The picker calls it Time; the "hourglass" key below is the
      // composed 3D shape, which is a different object entirely.
      time: hourglassFormation({ count, opacity: 0.3, ...p }),
      // the same cloud in its two-lobe remap, selected to showcase the pulse.
      // It reads as a volume, so it is built like one.
      beats: cloudFormation({ ...solid(3.6, 0.24), lobes: true }),
      // the ground plane's own reach is the far corner of its footprint, 8.5
      // at the 15 by 8 it ships with, and the scale dial moves the footprint
      // from there
      horizon: horizonFormation(solid(8.5, 0.34)),
      // one three.js geometry each, sampled across the surface
      sphere: geometryFormation(SPHERE_GEO, solid()),
      cube: geometryFormation(CUBE_GEO, solid(2)),
      pyramid: geometryFormation(PYRAMID_GEO, solid()),
      octahedron: geometryFormation(OCTA_GEO, solid()),
      dodecahedron: geometryFormation(DODECA_GEO, solid()),
      capsule: geometryFormation(CAPSULE_GEO, solid()),
      torus: geometryFormation(TORUS_GEO, solid(2.4)),
      diamond: geometryFormation(DIAMOND_GEO, solid()),
      spring: geometryFormation(SPRING_GEO, solid(2.3)),
      mobius: geometryFormation(MOBIUS_GEO, solid(2.3)),
      "torus-knot": geometryFormation(KNOT_GEO, solid(2.4)),
      icosahedron: geometryFormation(ICOSA_GEO, solid(2.1)),
      // composed shapes: a list of transformed, weighted parts
      ring: composedFormation(RING_PARTS, solid(2.4)),
      saturn: composedFormation(SATURN_PARTS, solid(2.5)),
      atom: composedFormation(ATOM_PARTS, solid(2.5)),
      hourglass: composedFormation(HOURGLASS_PARTS, solid()),
      galaxy: composedFormation(GALAXY_PARTS, solid(2.7)),
      tornado: composedFormation(TORNADO_PARTS, solid(2.5)),
      rose: composedFormation(ROSE_PARTS, solid(2.3)),
      bitcoin: composedFormation(BITCOIN_PARTS, solid()),
      // the three parametric volumes, on the same convention as the shapes:
      // the helix's reach is the far end of a strand, the flower's a petal
      // tip, the network's the tip of a branch
      dna: dnaFormation(solid(2.2, 0.32)),
      flower: flowerFormation(solid(2.4, 0.34)),
      veins: veinsFormation(solid(2.2, 0.3)),
      face: faceFormation(solid()),
    };
  }, [count, scale, diffusion]);

  /* the same objects as a flat list, so the per-frame chaos send can walk them
   * without allocating an array every frame */
  const registry = useMemo(() => Object.values(formations), [formations]);
  const registryRef = useRef(registry);

  /* each formation's own resting opacity, captured AS BUILT. The brightness
   * send writes on top of these numbers every frame, so it needs the value the
   * formation shipped with rather than whatever the last frame left there. It
   * is read here, in the same render the registry is made, before any frame can
   * touch the new objects. */
  const baseOpacity = useMemo(
    () => registry.map((f) => (typeof f.opacity === "number" ? f.opacity : 0.3)),
    [registry],
  );
  const baseRef = useRef(baseOpacity);

  /* what the frame callbacks read, written ON COMMIT rather than in the render
   * body. Four deferred inputs mean React can render this component in the
   * background and throw that render away, and a ref written there would leave
   * the audio sends writing onto a registry the engine never got. */
  useLayoutEffect(() => {
    cfgRef.current = cfg;
    registryRef.current = registry;
    baseRef.current = baseOpacity;
  });

  /* personality: mutated onto the stable formation objects, never rebuilt, so
   * scrubbing these sliders cannot restart a morph or drop a build cache */
  const { size, chaos, reach, force } = cfg;
  const chaosSent = useRef(0);
  const brightSent = useRef(0);
  useEffect(() => {
    for (const f of registry) {
      f.size = size;
      f.chaos = chaos;
      f.cursorReach = reach;
      f.cursorForce = force;
    }
    // the audio's sends write on top of these objects, per frame, and a rebuild
    // hands them fresh ones: forget what was applied so the next frame re-adds
    // it to the formations that are live now
    chaosSent.current = 0;
    brightSent.current = 0;
  }, [registry, size, chaos, reach, force]);

  /* The audio sends, resolved once per change into the units each aspect
   * speaks: the amount that aspect gains at a FULL signal. A send of 0
   * resolves to 0, which is how "this aspect ignores the music" is spelled.
   *
   * A PAUSED pulsation section resolves all three to 0, and this line is the
   * whole of what makes that true. Its transport leaves the three dials on
   * screen and live (controls.tsx), so nothing else is holding them back, and
   * the level they ride only decays toward 0 without ever arriving. Paused has
   * to mean NO SIGNAL rather than a signal with nothing playing, or the cloud
   * would keep whatever lift the last bar left on it. */
  const sends = useRef({ pulse: 0, chaos: 0, bright: 0 });
  useEffect(() => {
    if (!cfg.pulseOn) {
      sends.current = { pulse: 0, chaos: 0, bright: 0 };
      return;
    }
    sends.current = {
      // the pulse's depth, whichever clock is driving it: the metronome and the
      // analyser's beat both arrive as the same 0..1 energy, so one dial owns
      // how hard a hit lands
      pulse: dial10(cfg.sendPulse, 0, 0.5, 1),
      // added chaos dial points: 5 adds up to two and a half, 10 adds five
      chaos: dial10(cfg.sendChaos, 0, 2.5, 5),
      // a MULTIPLIER on each formation's resting opacity: 5 lifts it to 1.8
      // times at a full signal, 10 to three, and alpha saturates at 1 anyway
      bright: dial10(cfg.sendBright, 0, 0.8, 2),
    };
  }, [cfg.pulseOn, cfg.sendPulse, cfg.sendChaos, cfg.sendBright]);

  /* energy: a 0..1 SIGNAL (not a dial) sampled once a frame, and the demo's
   * ONE audio read per frame. Two things reach it: the metronome, the demo's
   * own clock at the bpm knob, and the audio's low-band transient. They are
   * exclusive by construction, since the type menu is one choice, and both are
   * scaled by the same pulse reach. */
  const beat = useRef({ bpm: DEFAULTS.bpm, own: false });
  useEffect(() => {
    beat.current = { bpm: cfg.bpm, own: cfg.pulseOn && cfg.pulseType === "beat" };
  }, [cfg.bpm, cfg.pulseOn, cfg.pulseType]);
  /* the metronome's own LEVEL. The metronome makes a beat and no sound at all,
   * so the analyser has nothing to read and the two sends that ride the level
   * (chaos and brightness) were dead on it. This is that missing number: a slow
   * follower on the metronome's own envelope, with the same attack and release
   * the analyser's broadband reading uses, so one signal answers "how much is
   * going on" whatever is driving the beat. It decays to 0 on its own the
   * moment the metronome stops, so nothing has to switch it off. */
  const ownLevel = useRef(0);
  /* WHETHER SOUND IS ACTUALLY COMING OUT, which is not the same as a source
   * being selected: the demo arrives with Shotgun chosen and the transport
   * paused (see DEFAULTS), and even a pressed play can be held back by the
   * browser or paused from outside (another tab taking the audio focus). The
   * credit deck is fed from THIS rather than from the selection, so a track's
   * attribution is raised at the moment it becomes audible, whenever that
   * turns out to be.
   * It is an EVENT from the audio itself (onSounding), never a reading taken
   * in the frame loop. A credited track may not play without its credit, and
   * the loop is not there to be counted on: under prefers-reduced-motion the
   * field renders on demand, so a visitor who is only listening runs no frames
   * at all and a credit waiting for one would never come. */
  const [sounding, setSounding] = useState(false);
  useEffect(() => onSounding(setSounding), []);
  const energy = useCallback((dt: number) => {
    // the whole demo's audio frame, sampled ONCE here and spent right here:
    // every send this file has lands in the lines below, off these very
    // numbers, so nothing downstream ever reads the analyser a second time.
    const a = sampleAudio(dt);
    const s = sends.current;

    // the metronome, at FULL depth: the send scales it further down, so the
    // clock keeps time even with the pulse reach at 0.
    const { bpm, own } = beat.current;
    const tick = own ? pulse(dt, bpm) : 0;
    const d = Math.min(dt, 0.05);
    const k = tick > ownLevel.current ? 1 - Math.exp(-d / 0.12) : 1 - Math.exp(-d / 0.45);
    ownLevel.current += (tick - ownLevel.current) * k;
    // ONE level for every mode: the analyser's while a source plays, the
    // metronome's own while the demo's clock is the only thing beating.
    const level = a.playing ? a.level : ownLevel.current;

    // CHAOS takes the LEVEL, the broadband loudness: how agitated the cloud
    // is should follow how much is going on in the track, not each kick. It
    // rides the same formation objects the personality effect mutates, so a
    // moving send costs one field write per formation and zero renders.
    const extra = s.chaos * level;
    if (extra !== chaosSent.current) {
      chaosSent.current = extra;
      const v = Math.min(10, cfgRef.current.chaos + extra);
      for (const f of registryRef.current) f.chaos = v;
    }

    // BRIGHTNESS takes the LEVEL too, onto the other field the engine reads
    // live off these same objects: each formation's resting opacity. The engine
    // eases toward it at its own rate, so this swells through a loud passage
    // instead of flickering, which is exactly the difference between it and the
    // beat flash the pulse already carries.
    const lift = s.bright * level;
    if (lift !== brightSent.current) {
      brightSent.current = lift;
      const reg = registryRef.current;
      const base = baseRef.current;
      for (let i = 0; i < reg.length; i++) reg[i].opacity = Math.min(1, base[i] * (1 + lift));
    }

    // PULSATION takes the BEAT, the low-band transient, because the pump, the
    // tremble and the brightness flash are all meant to land ON the hit.
    return Math.min(1, s.pulse * (tick + a.beat));
  }, []);

  /* What beats. Playback starts inside the panel's own event handler, which is
   * the gesture a browser needs to let an AudioContext resume, and it starts at
   * a tempo the caller names: a pattern is scheduled a beat at a time off the
   * tempo its source carries, so whichever tempo won has to be written onto the
   * source before it starts. */
  const tempoRef = useRef(DEFAULTS.bpm);
  const start = useCallback((v: PulseType, bpm: number) => {
    const src = sourceById(v);
    if (!src) {
      // the metronome is not a source: it makes no sound, so nothing plays
      stopSource();
      return;
    }
    if (src.kind === "synth") {
      src.bpm = bpm;
      tempoRef.current = bpm;
    }
    playSource(src.id);
  }, []);
  /* Picking a source. It CHOOSES, and it plays only where something is playing
   * already: the transport is the one control in this section that starts
   * sound, and the menu is reachable in both its states now that pausing leaves
   * the section open, so a pick made while paused has to wait for play rather
   * than sneak past a paused transport.
   *
   * The dial follows the pick either way, since it is on screen either way: a
   * synthesized pattern hands over its OWN tempo, so "Drive · 124" reads 124
   * from the moment it is picked rather than lurching to whatever the metronome
   * was left at, and a recorded track carries its own and leaves the dial. */
  const onPulse = useCallback(
    (v: PulseType) => {
      const bpm = nominalBpm(v) ?? cfgRef.current.bpm;
      if (cfgRef.current.pulseOn) start(v, bpm);
      setCfg((c) => ({ ...c, pulseType: v, bpm }));
    },
    [start],
  );
  /* the section's transport. Pause stops what is playing and leaves every
   * setting in the section where it is, since all of them are still on screen;
   * play starts whatever the menu was left showing, on the tempo showing with
   * it and at the level showing with it, from this very click, which is what
   * keeps the gesture. A tempo set while paused is one somebody chose, and a
   * transport that overwrote it would make that dial a lie. */
  const onPulseOn = useCallback(
    (on: boolean) => {
      if (!on) {
        stopSource();
        setCfg((c) => ({ ...c, pulseOn: false }));
        return;
      }
      start(cfgRef.current.pulseType, cfgRef.current.bpm);
      setCfg((c) => ({ ...c, pulseOn: true }));
    },
    [start],
  );
  const onUpload = useCallback((file: File) => {
    // load and play in the SAME handler: loadUpload only hands the file over,
    // and a playSource on a later tick would no longer be a user gesture
    loadUpload(file);
    playSource(UPLOAD_ID);
    setCfg((c) => ({ ...c, pulseOn: true, pulseType: UPLOAD_ID }));
  }, []);

  /* BPM, for the sample beats. The patterns are scheduled a beat at a time off
   * the tempo their source carries, and the transport reads it when it STARTS
   * and never again, so the honest way to move it is to restart the pattern: the
   * dial writes the tempo onto the source and the pattern is stopped and started
   * again at it. It waits for the drag to settle first, because a restart per
   * pointer event would stutter the audio. The metronome needs none of this: it
   * reads the dial every frame, and a paused section needs none of it either:
   * there is no pattern running to restart, and play picks the dial up as it
   * stands. */
  useEffect(() => {
    if (!cfg.pulseOn) return;
    const src = sourceById(cfg.pulseType);
    if (src?.kind !== "synth" || cfg.bpm === tempoRef.current) return;
    const id = window.setTimeout(() => {
      tempoRef.current = cfg.bpm;
      src.bpm = cfg.bpm;
      stopSource();
      playSource(src.id);
    }, TEMPO_SETTLE_MS);
    return () => window.clearTimeout(id);
  }, [cfg.bpm, cfg.pulseOn, cfg.pulseType]);
  useEffect(() => {
    // a 0..10 dial straight onto WebAudio's 0..1 gain (dial10 through 5 is
    // exactly this line); re-applied on a source change, since starting one
    // builds the master gain
    setVolume(cfg.volume / 10);
  }, [cfg.volume, cfg.pulseOn, cfg.pulseType]);

  /* the face dials ride effects, not props: setFaceGesture is a module-level
   * dial exactly so hosts can scrub it without touching the formation */
  useEffect(() => {
    setFaceGesture({ jaw: cfg.faceMod, lips: cfg.faceMod });
  }, [cfg.faceMod]);
  useEffect(() => {
    setFaceGesture({ blink: cfg.faceBlink });
  }, [cfg.faceBlink]);

  /* gather and orient need canvas-relative pointer coordinates, so the canvas
   * wrapper is measured rather than the window. It is also the ZONE, the same
   * way the engine's own pointer is: the listeners sit on the stage, so a
   * pointer over a control is a pointer that is not there, both hooks return
   * null, and the engine eases the cloud home. Anything else and the cloud
   * would lean toward a slider being dragged.
   *
   * The stage now runs FULL BLEED under two floating cards, so its rect alone
   * would count a card as canvas: the cards are subtracted from the zone as
   * holes. Their collection is live, so it never needs rebuilding. */
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const pointer = useRef({ x: 0, y: 0, has: false });
  /* the stage's own rect, taken with the resize measurement below and read from
   * here by both per-frame hooks: a getBoundingClientRect inside a frame
   * callback is a forced layout, on the same frames the panel's renders are
   * already dirtying. The stage never moves without resizing (inset 0 over the
   * whole app on a wide screen, a fixed band above the rail below the
   * breakpoint), so the observer is the only thing that has to refresh it. */
  const rectRef = useRef<DOMRect | null>(null);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const cards = document.getElementsByClassName("card");
    const over = (r: DOMRect, x: number, y: number) =>
      x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
    const onMove = (e: PointerEvent) => {
      pointer.current.x = e.clientX;
      pointer.current.y = e.clientY;
      // the rect test is load bearing even with stage-scoped listeners: a drag
      // that started on the stage keeps delivering moves through pointer
      // capture after it leaves, and no pointerleave follows it out
      let has = over(el.getBoundingClientRect(), e.clientX, e.clientY);
      for (let i = 0; has && i < cards.length; i++) {
        if (over(cards[i].getBoundingClientRect(), e.clientX, e.clientY)) has = false;
      }
      pointer.current.has = has;
    };
    const onLeave = () => {
      pointer.current.has = false;
    };
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerleave", onLeave);
    // a cancelled pointer (a touch turning into a scroll) sends no leave
    el.addEventListener("pointercancel", onLeave);
    return () => {
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerleave", onLeave);
      el.removeEventListener("pointercancel", onLeave);
    };
  }, []);

  /* Two numbers off the same measurement, taken once per resize.
   *
   * WORLD is the stage's world extents, which the panel's positioners need to
   * place a pocket in the units the hook returns: the same projection gather
   * does per pointer move.
   *
   * INSET is the SAFE AREA, in css px. The canvas is full bleed and the cards
   * float over it, so the middle of the canvas is not the middle of what a
   * person sees: the empty space between the cards is the frame their eye
   * reads, and a formation centered on the canvas sits visibly off center in
   * it. The engine subtracts these and centers the cloud in what is left, by
   * shifting the group, so it composes with the parallax drift and the drag
   * pose instead of fighting them. Absent (every side 0) it costs nothing, and
   * that is exactly what the stacked layout hands it. */
  const [world, setWorld] = useState({ w: WORLD_H * 1.6, h: WORLD_H });
  const [inset, setInset] = useState<Inset>(NO_INSET);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    // live, like the pointer zone's: the cards outlive every measurement
    const cards = document.getElementsByClassName("card");
    const measure = () => {
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return;
      rectRef.current = r;
      setWorld({ w: WORLD_H * (r.width / r.height), h: WORLD_H });
      // a prop the engine reads: a fresh object only where the numbers moved,
      // so a resize that changes nothing changes nothing
      const next = insetOf(r, cards);
      setInset((prev) => (sameInset(prev, next) ? prev : next));
    };
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    // and once right here: the frame hooks read the rect this takes, so the
    // first measurement cannot wait on the observer's first delivery
    measure();
    return () => ro.disconnect();
  }, []);

  const bendRef = useRef(cfg.bend);
  useEffect(() => {
    bendRef.current = cfg.bend;
  }, [cfg.bend]);
  const gather = useCallback(() => {
    if (bendRef.current <= 0 || !pointer.current.has) return null;
    const r = rectRef.current;
    if (!r || r.width < 1 || r.height < 1) return null;
    // screen to world through the shared camera numbers, so the attractor lands
    // exactly under the pointer at z = 0
    const worldW = WORLD_H * (r.width / r.height);
    GATHER_OUT.x = ((pointer.current.x - r.left) / r.width - 0.5) * worldW;
    GATHER_OUT.y = -((pointer.current.y - r.top) / r.height - 0.5) * WORLD_H;
    GATHER_OUT.s = bendRef.current;
    return GATHER_OUT;
  }, []);

  /* Orient, as THREE dials over one payload. Two of them are the demo's own
   * work on the target it hands the hook: how far that target leans (amplitude)
   * and how far back down the pointer's path it is read from (delay). The third
   * is the payload's own speed, which is the engine easing the pose toward
   * whatever it was given.
   *
   * The delay is a real DELAY rather than a second ease: every frame's pointer
   * position rides a small ring buffer, and the target is the sample from `lag`
   * seconds ago, so the cloud retraces the path the cursor actually took
   * instead of cutting the corners of it. */
  const lookRef = useRef({ amp: 1, speed: 0, lag: 0 });
  useEffect(() => {
    lookRef.current = {
      // 5 is the lean the demo has always had, 10 doubles it, 0 faces front
      amp: dial10(cfg.lookAmp, 0, 1, 2),
      speed: ORIENTED.has(cfg.formation) ? cfg.look : 0,
      lag: dial10(cfg.lookLag, 0, 0.08, 0.6),
    };
  }, [cfg.formation, cfg.look, cfg.lookAmp, cfg.lookLag]);
  const look = useMemo(
    () => ({
      t: new Float32Array(LOOK_N),
      x: new Float32Array(LOOK_N),
      y: new Float32Array(LOOK_N),
      n: 0,
    }),
    [],
  );
  const orient = useCallback(() => {
    const { amp, speed, lag } = lookRef.current;
    if (speed <= 0 || !pointer.current.has) {
      // a pointer that left starts a fresh path: a stale one would replay on
      // the way back in, seconds after it was true
      look.n = 0;
      return null;
    }
    const r = rectRef.current;
    if (!r || r.width < 1 || r.height < 1) return null;
    const nx = Math.max(-1, Math.min(1, ((pointer.current.x - r.left) / r.width - 0.5) * 2));
    const ny = Math.max(-1, Math.min(1, ((pointer.current.y - r.top) / r.height - 0.5) * 2));
    const now = performance.now() / 1000;
    const head = look.n % LOOK_N;
    look.t[head] = now;
    look.x[head] = nx;
    look.y[head] = ny;
    look.n++;
    let sx = nx;
    let sy = ny;
    if (lag > 0) {
      // walk back from the newest until one is old enough, which is a handful
      // of frames and never more than the buffer. Running out of history is not
      // an error: it is a pointer that has only just arrived, and the oldest
      // sample is the honest answer.
      const want = now - lag;
      const back = Math.min(look.n, LOOK_N);
      for (let k = 0; k < back; k++) {
        const j = (look.n - 1 - k) % LOOK_N;
        sx = look.x[j];
        sy = look.y[j];
        if (look.t[j] <= want) break;
      }
    }
    // +ry turns the front face toward +x, +rx tips it down
    ORIENT_OUT.rx = sy * 0.35 * amp;
    ORIENT_OUT.ry = sx * 0.6 * amp;
    ORIENT_OUT.speed = speed;
    return ORIENT_OUT;
  }, [look]);

  /* The light pockets. Up to four ride at once and they COMPOSE, so the payload
   * is a LIST: x and y come from each pocket's locator in world units, the
   * depth is a 0..10 dial with 5 on the z = 0 plane, and a pocket the panel has
   * removed is simply not in the list.
   *
   * The tint is TWO values and a switch, exactly like the dot color: the panel
   * keeps a light-page color and a dark-page one, both editable and neither
   * overwritten, and the resolved theme picks which of them this frame sends.
   * Undefined is still a real state on top of that, the pocket that only
   * brightens, and the switch is how you leave the color and come back to it.
   *
   * A pocket switched off, or a whole section switched off, is simply not in
   * the list, which is the same thing the panel says: the engine eases that
   * light away rather than cutting it.
   *
   * The array and its four payload objects are allocated ONCE and rewritten in
   * place, because this runs every frame like every other hook here. */
  const spotsRef = useRef(cfg.spotlights);
  useEffect(() => {
    spotsRef.current = cfg.spotsOn ? cfg.spotlights : NO_SPOTS;
  }, [cfg.spotsOn, cfg.spotlights]);
  const orientedRef = useRef(false);
  useEffect(() => {
    orientedRef.current = ORIENTED.has(cfg.formation);
  }, [cfg.formation]);
  // which half of every pocket's color pair is live. A ref, because the hook
  // below runs per frame and the theme is a render-time answer
  const darkRef = useRef(dark);
  useEffect(() => {
    darkRef.current = dark;
  }, [dark]);
  const spotBuf = useMemo<FieldSpotlight[]>(
    () => Array.from({ length: SPOT_MAX }, () => ({ x: 0, y: 0 }) as FieldSpotlight),
    [],
  );
  const spotOut = useMemo<(FieldSpotlight | null)[]>(
    () => new Array(SPOT_MAX).fill(null),
    [],
  );
  const spotlights = useCallback(() => {
    const list = spotsRef.current;
    for (let i = 0; i < SPOT_MAX; i++) {
      const s = i < list.length ? list[i] : undefined;
      // a pocket that is off, or one with no intensity left, is a null entry:
      // the engine eases that pocket's presence out instead of cutting it
      if (!s || !s.on || s.intensity <= 0) {
        spotOut[i] = null;
        continue;
      }
      const p = spotBuf[i];
      p.x = s.x;
      p.y = s.y;
      // depth only where the panel offered it: on a flat formation the pocket
      // sits on the plane the cloud is on
      p.z = orientedRef.current && s.depth ? dial10(s.z, -2.5, 0, 2.5) : 0;
      p.intensity = s.intensity;
      p.radius = s.radius;
      // the theme SELECTS one of the pocket's two colors, it never writes the
      // other: the one it is not sending is still sitting in the panel, edited
      p.tint = s.tintOn ? (darkRef.current ? s.tintDark : s.tintLight) : undefined;
      spotOut[i] = p;
    }
    return spotOut;
  }, [spotBuf, spotOut]);

  /* THE FACE'S VOICE. Two inputs, both real, and two ways into them:
   *   SIMULATION, which is setFaceDrive, what a voice agent calls as TTS
   *     chunks arrive. No audio at all.
   *   A FILE, either one of the bundled speech clips or the user's own, routed
   *     through the FACE's analyser (attachFaceAudio), which is what a recorded
   *     clip or a WebRTC track looks like to it.
   *
   * The voice is NOT the soundtrack. They are two sources on two analysers
   * asked two different questions, so the music is never offered here: the
   * clips in voices.ts are speech, which is what a mouth can read. They are
   * public domain, so the credit deck stays fed by the soundtrack alone.
   *
   * The element is one element, so picking either source stops the last. */
  const voiceRef = useRef<HTMLAudioElement | null>(null);
  const voiceUrl = useRef<string | null>(null);
  const [voiceName, setVoiceName] = useState<string | null>(null);
  const [voice, setVoice] = useState<VoiceId>(VOICE_SIM);
  const [voiceOn, setVoiceOn] = useState(false);

  /* start a source, and say whether it started. Everything here runs INSIDE
   * the click that asked for it: attaching, resuming and playing on a later
   * tick is no longer the user gesture a browser needs. */
  const startVoice = useCallback((v: VoiceId) => {
    const el = voiceRef.current;
    // the simulation is the timer below, and it pushes into the same face the
    // element would drive: the element has to be quiet for it
    if (v === VOICE_SIM) {
      el?.pause();
      return true;
    }
    // everything else is a file: one of the bundled speech clips, or the user's
    // own. No file is nothing to start, and the transport says so rather than
    // claiming to be speaking.
    const url = v === VOICE_UPLOAD ? voiceUrl.current : voiceClipFile(v);
    if (!el || !url) return false;
    el.src = url;
    el.load();
    attachFaceAudio(el);
    resumeFaceAudio();
    // a browser that refuses playback anyway leaves the transport telling the
    // truth rather than claiming to be speaking
    void el.play().catch(() => setVoiceOn(false));
    return true;
  }, []);

  /* the voice menu. Picking a source STARTS it, the way picking a soundtrack
   * does: a menu that chose something and left it silent would read as broken. */
  const onVoice = useCallback(
    (v: VoiceId) => {
      setVoice(v);
      setVoiceOn(startVoice(v));
    },
    [startVoice],
  );
  /* the transport, one control over all three sources: it stops what is
   * running, or starts whatever the menu is showing. */
  const onVoiceRun = useCallback(
    (on: boolean) => {
      if (!on) {
        voiceRef.current?.pause();
        setVoiceOn(false);
        return;
      }
      setVoiceOn(startVoice(voice));
    },
    [startVoice, voice],
  );
  const onVoiceFile = useCallback(
    (file: File) => {
      if (voiceUrl.current) URL.revokeObjectURL(voiceUrl.current);
      voiceUrl.current = URL.createObjectURL(file);
      setVoiceName(file.name);
      setVoice(VOICE_UPLOAD);
      setVoiceOn(startVoice(VOICE_UPLOAD));
    },
    [startVoice],
  );
  useEffect(
    () => () => {
      voiceRef.current?.pause();
      if (voiceUrl.current) URL.revokeObjectURL(voiceUrl.current);
    },
    [],
  );

  /* THE VOICE'S LEVEL, and the only place it can be set: the face's audio runs
   * element, analyser, speakers (attachFaceAudio), with no gain node of its own
   * anywhere along it, so the ELEMENT is the volume control. The soundtrack's
   * volume is a master gain inside the other graph entirely (beat.ts), which is
   * what keeps the two independent: neither number sits on the other's path,
   * and the music plays on through a voice turned all the way down.
   *
   * They are not isolated the same way, though, and the panel says so: the
   * music's analyser taps AHEAD of its master gain, so the cloud reads the mix
   * at unit gain whatever the volume, while the face's analyser taps this
   * element itself.
   *
   * The dial folds away on the simulation, which pushes amplitude and plays no
   * audio, and with the face block itself; the element is paused the moment the
   * formation leaves the face. Either way there is nothing playing for the
   * number it was left on to be heard on. */
  useEffect(() => {
    const el = voiceRef.current;
    // a 0..10 dial straight onto the element's 0..1 level, which is the line
    // the soundtrack's own volume takes onto its gain
    if (el) el.volume = cfg.voiceVolume / 10;
  }, [cfg.voiceVolume]);

  /* The voice agent path, made runnable without a service: a timer pushes an
   * amplitude envelope the way a TTS stream would push chunk levels. Nothing
   * here is special to the demo except where the numbers come from. */
  useEffect(() => {
    if (!voiceOn || voice !== VOICE_SIM) return;
    const started = performance.now();
    const id = window.setInterval(() => {
      const t = (performance.now() - started) / 1000;
      // syllables at about 4.5 Hz, inside a slower phrase envelope
      const syllable = Math.max(0, Math.sin(t * Math.PI * 4.5));
      const phrase = 0.5 + 0.5 * Math.sin(t * 0.9);
      setFaceDrive({
        open: syllable * phrase,
        spread: Math.max(0, Math.sin(t * 1.7)) * 0.6,
        round: Math.max(0, Math.sin(t * 1.1 + 2)) * 0.5,
      });
    }, 40);
    return () => {
      window.clearInterval(id);
      // an ended utterance must CLOSE the mouth, not freeze it open
      clearFaceDrive();
    };
  }, [voiceOn, voice]);

  /* leaving the face ends the utterance: the panel's transport hides with the
   * face block, so a voice left running would have no visible control. The
   * interval's cleanup above then closes the mouth. */
  useEffect(() => {
    if (cfg.formation === "face") return;
    voiceRef.current?.pause();
    setVoiceOn(false);
  }, [cfg.formation]);

  return (
    <div className="app">
      <div className="stage" ref={wrapRef}>
        <DsField
          formations={formations}
          formation={cfg.formation}
          tint={tint}
          // the cursor section's switch IS the engine's own "off" mode, so the
          // panel keeps the effect it was left on for the way back. The wake is
          // its own dial and rides its own path through the engine, so an off
          // section has to zero it too, or the pointer would still drag dots
          // around with every cursor control hidden
          mode={cfg.cursorOn ? cfg.mode : "off"}
          trail={cfg.cursorOn ? cfg.trail : 0}
          additive={cfg.additive}
          shine={cfg.shine}
          round={cfg.round}
          intensity={cfg.intensity}
          parallax={cfg.parallax}
          // how hard the cloud answers a DRAG on the canvas, and how long it
          // keeps turning once the drag lets go. A flat field has no front to
          // turn, so there is nothing a drag could mean on one: the dial is
          // hidden there and the engine is handed 0
          spin={SPATIAL.has(cfg.formation) ? cfg.spin : 0}
          shuffle={cfg.shuffle}
          transition={cfg.transition}
          // the space the cards leave, so the cloud centers where a person
          // looks rather than where the canvas happens to end
          inset={inset}
          mobile={cfg.mobile}
          // the per-point material, so the face's glow hook and the light
          // pockets can light individual dots
          glow
          energy={energy}
          gather={gather}
          orient={orient}
          spotlights={spotlights}
          capacity={CAPACITY}
        />
      </div>
      {/* the face's own element. A sample that runs out ends the utterance
          rather than leaving a transport claiming to be playing. */}
      <audio ref={voiceRef} preload="none" onEnded={() => setVoiceOn(false)} />
      {/* the bundled tracks are free WITH ATTRIBUTION, so the deck is mounted
          for the whole session and fed by the ONE thing in this demo that
          requires attribution: the soundtrack. The metronome is not a source, a
          synthesized pattern is the browser's own, an uploaded file is the
          user's, and the face's voice plays none of them, so in every one of
          those cases there is simply no credit to raise.
          It is fed by what is AUDIBLE, not by what is selected: the demo opens
          with a credited track already chosen, and a browser holds that sound
          until the page is touched, so a credit raised at mount would have
          come and gone before a note played. Tied to the sound itself, the
          attribution lands with the music however long that takes. */}
      <Credits sourceId={sounding ? cfg.pulseType : null} />
      <Controls
        cfg={cfg}
        set={set}
        dark={dark}
        world={world}
        onPulse={onPulse}
        onPulseOn={onPulseOn}
        onUpload={onUpload}
        voice={voice}
        voiceName={voiceName}
        voiceOn={voiceOn}
        onVoice={onVoice}
        onVoiceRun={onVoiceRun}
        onVoiceFile={onVoiceFile}
      />
    </div>
  );
}
