---
name: nebula
description: Use for all work with nebula, the DsField WebGL point field for React (a repository to fork or copy from, not a published package). Read it to bring the code into a project, to put DsField on a page, to pick or write a formation, to set a 0..10 dial, to connect the energy, gather, orient or spotlights callbacks, to add spotlights or a safe area inset, to set the mobile point budget, or to make the face speak from an audio element or from a voice agent. Read it also when the canvas stays empty, when the points scatter again after a resize, when a formation shows fewer points than its count, when a morph snaps instead of eases, when the pointer changes nothing, or when two faces speak with one mouth.
---

# nebula

nebula gives a React application one WebGL point field. The component is `DsField`. It shows
its own canvas and one persistent set of up to 15000 points. The points take the shape of the
formation you name. A change of that name moves every point to the new shape.

A formation is content, not engine. The repository holds the engine and nine generic
formations. It also holds an adapter for any three.js `BufferGeometry`, and a face that speaks
from an audio signal.

Use the field as a background that answers the pointer. Use it as a shape that a page morphs
through. Use it as the face of a voice agent.

## Words in this skill

One word has one meaning here. The table gives that meaning.

| Word | Meaning |
| --- | --- |
| point | One element of the field. |
| field | One `DsField` instance and the points it shows. |
| host | The application that uses the library. |
| registry | The object that you give to the `formations` prop. |
| formation | One shape and the behavior of its points. |
| factory | A function that makes a formation. |
| dial | A number in the range 0 to 10, where 5 is the tuned nominal value. |
| morph | The movement of the points from one formation to the next. |
| world unit | The unit of the 3D space. It is not a pixel. |
| show | To put on the screen. |
| ease | To move smoothly to a value, across more than one frame. |
| snap | To change at once, in one frame. |
| build | The formation function that makes the point positions. |
| callback | A function that the host writes and the field calls. |

## Put the code in the project

Warning: this library is not on a package registry. There is no install command for it.

1. Copy the source into the project, or work inside a fork of the repository
   (https://github.com/0backlog/nebula). The engine is `src/field.tsx` (the core) plus the
   seven `field-*` organ files its header lists (units, viewport, shader, pointer, cursor,
   drag, spot); take them together. `src/formations.ts`, `src/field-shapes.ts` and the three
   `field-face-*` files are each optional; `src/sampling.ts` serves the last two.
2. Install the three packages the engine expects the host to supply.

```sh
npm install three @react-three/fiber
npm install -D @types/three
```

3. Check the versions. The engine expects `react >=19`, `react-dom >=19`, `three >=0.163 <1`
   and `@react-three/fiber >=9`.
4. Use TypeScript 5.7 or newer, and install `@types/three`: three ships no types of its own
   and `@react-three/fiber` does not pull them in, so without it the engine's types have
   nothing to resolve `three` against.

three 0.163 is the floor, because the dot shader needs the WebGL2 renderer. The code is ESM
and runs in a browser only.

The examples in this skill import from `@0backlog/nebula`, which is how the repository's own
demo resolves the engine. In a project of your own, that specifier is the path you copied the
source to.

Warning: the `"use client"` directive on `src/field.tsx` does not make `DsField` renderable
from a server component.

The directive means the engine needs no client wrapper file of its own. The host module that
builds the registry and renders the field is still a client module, because the `formations`
prop carries functions and a function cannot cross the server boundary.

## Put the field on a page

Warning: the component fills its parent. A parent with no height shows nothing.

1. Make the registry once, outside the render function.
2. Give the component a parent box with a size.
3. Set `formations`, `formation` and `tint`. All three are necessary.

```tsx
"use client";

import { DsField, curtainFormation } from "@0backlog/nebula";

// build the registry once, outside render: a new object identity rebuilds every formation
const formations = {
  rain: curtainFormation({ count: 6000, flow: "down", opacity: 0.3 }),
};

export default function Background() {
  return (
    <div style={{ position: "fixed", inset: 0 }}>
      <DsField formations={formations} formation="rain" tint="#fafafa" />
    </div>
  );
}
```

The field mounts with the opacity and the size of the first formation. The first second does not
ease down from a constant value.

## Every dial is 0..10

One scale runs the whole surface. 0 is the minimum, 10 is the maximum, and 5 is always the
tuned nominal value.

These props are dials: `shine`, `round`, `additive`, `trail`, `intensity`, `parallax`, `spin`,
`transition`, `shuffle`. These formation fields are dials: `size`, `chaos`, `cursorReach`,
`cursorForce`, `diffusion`. These payload fields are dials: `s` on `gather`, `speed` on
`orient`, `intensity` and `radius` on a spotlight. The three face gesture channels are dials.

An absent dial on a formation sits at 5. A component dial has its own default, and the table
below gives each one. The effects that start off default to 0.

`dial10(v, min, nominal, max)` is the one map from a dial to internal units, and it is exported.
The range 0..5 spans `min` to `nominal`. The range 5..10 spans `nominal` to `max`. The map is
piecewise linear. The input clamps to 0..10, and a NaN input resolves to the nominal value.
Every dial resolves through this function at the component boundary. The engine past that line
reads internal units only. Call `dial10` for a host knob that must follow the same curve.

Warning: some numbers on the surface are not dials. A wrong scale here is a common defect.

| Number | Scale |
| --- | --- |
| A formation `opacity` | A plain 0..1 material value. |
| The `energy` return value | A raw 0..1 signal, because it is a measurement. |
| `mobile` | A plain fraction of the point count, not a dial curve. |
| The `gather` and spotlight positions | World units. |
| A formation `radius` | World units. |
| `inset` | CSS pixels of the canvas. |
| The `r` field of `gather` | A raw multiplier on the falloff spread. 1.6 reproduces the default spread. |

## DsField props

| Prop | Type | Default | What it does |
| --- | --- | --- | --- |
| `formations` | `Record<string, FieldFormation>` | required | The registry. A new object identity rebuilds every formation. |
| `formation` | `string` | required | The formation key that shows now. A change morphs the whole field, point by point. An unregistered key falls back to the first registered formation. |
| `tint` | `string` | required | Any CSS color. The engine applies it live and eases it, so a color change is a transition. `shine`, `round` and `additive` ease the same way. |
| `mode` | `"repel" \| "attract" \| "vortex" \| "off"` | `"repel"` | The cursor physics. `"off"` stops the point physics only, and the stop is an ease, not a cut: the influence fades out where the pointer was last seen, and a change between two live modes fades through the same dip. Each mode falls to exactly zero at its own rim, so there is no ring around the pointer. |
| `shine` | `number` 0..10 | `0` | The per point shimmer. 5 is the nominal shimmer and 10 is three times as strong. |
| `glow` | `boolean` | `false` | Not a dial. It turns the per point material on, so a formation `glow` callback can light single points. It matches the plain material when nothing glows. |
| `round` | `number` 0..10 | `10` | The corner shape of the mark. 0 is a square, 5 is the nominal rounded corner, 10 is a circle. |
| `additive` | `number` 0..10 | `0` | Above 0 the blend mode changes to additive and a halo comes in. 5 is the half halo and 10 is the full glow. |
| `trail` | `number` 0..10 | `0` | The cursor drag trail. 5 is a half strength trail and 10 is the full elastic trail. It is inert on floor formations and under reduced motion. |
| `intensity` | `number` 0..10 | `5` | It scales the resting opacity of every formation. 5 keeps each formation as it is tuned, 0 blacks the field out, 10 triples it. |
| `parallax` | `number` 0..10 | `5` | The pointer drift of the whole field. 0 is off, 5 is the tuned drift, 10 is half again as far. It is a pure translation, so it is also visible on a flat formation. |
| `inset` | `FieldInset` | none | The safe area, in CSS pixels of the canvas. See the safe area section. |
| `spin` | `number` 0..10 | `5` | The answer of the field to a drag on its canvas. At 5 a drag across the full canvas width is half a turn. 10 doubles the travel. 0 turns the drag off and eases any turn back to zero. |
| `transition` | `number` 0..10 | `5` | The duration of a morph. 5 is the tuned 1.15 seconds, 0 is the slow 6 seconds, 10 is the near instant 0.12 seconds. |
| `shuffle` | `number` 0..10 | `0` | The transit scatter of a morph. 0 is a straight line per point. 5 detours the typical point about 0.9 world units and 10 about 2.4. |
| `mobile` | `number` 0..10 | `10` | The phone point budget. Below 768 CSS pixels of canvas width the shown count scales by `mobile` / 10. |
| `energy` | `(dt: number) => number` | none | A raw 0..1 signal, sampled once per frame with the frame delta. The field pulses and trembles with it. |
| `gather` | `() => { x, y, r?, s? } \| null` | none | A world space attractor. The points pool toward it and trail it when it moves. |
| `orient` | `() => { rx, ry, speed? } \| null` | none | A target pose for the whole field, in radians. The engine eases toward it. |
| `spotlights` | `FieldSpotlight[] \| (() => (FieldSpotlight \| null)[] \| null)` | none | Up to four light pockets. See the spotlights section. |
| `capacity` | `number` | the length of the first build | The buffer headroom, in points. See the rules below. |

Internal ranges, for a host that must predict a value:

| Dial | 0 | 5 | 10 |
| --- | --- | --- | --- |
| `shine` | 0 | 1 | 3 |
| `round` | 0 | 0.5 | 1 |
| `additive` | 0 | 0.5 | 1 |
| `trail` | 0 | 0.5 | 1 |
| `intensity` | 0 | 1 | 3 |
| `parallax` | 0 | 1 | 1.5 |
| `transition` | 6 s | 1.15 s | 0.12 s |
| `shuffle` | 0 | 0.9 world units | 2.4 world units |
| formation `size` | 0.008 | 0.032 | 0.08 world units |
| formation `chaos` | 0 | 1 | 5 |
| formation `cursorReach` | 0 | 2.2 | 3 world units |
| formation `cursorForce` | 0 | 0.85 | 3 |
| `diffusion` on a shape | 0 | 0.02 | 0.12 world units |
| `diffusion` on the face | 0 | 0.008 | 0.05 world units |
| spotlight `intensity` | off | 2.5x | 6x |
| spotlight `radius` | 0.2 | 1.1 | 3 world units |

## The rules that the types do not show

Obey these seven rules. Each broken rule gives a defect that is hard to trace back to its cause.

Warning: a new registry object identity rebuilds every formation in it.

1. Make the registry once, outside the render function. A `useMemo` with a stable dependency
   list is the other correct place.

Warning: a formation writes its own state into its closure. Two fields that share one formation
object fight over that state.

2. Call each factory one time for each canvas.

Warning: without `capacity` the buffer takes the length of the first build. The engine then
clamps a later formation that builds more points to that same length.

3. Set `capacity` to the largest count of your formations when the counts differ.
4. Set `capacity` before mount. A change of the prop after mount does nothing.

Warning: the field calls `gather`, `orient` and a callback `spotlights` once per frame.

5. Make each of those callbacks once with `useCallback`, and read the live values from a ref.

Warning: positions are world units and dials are 0..10.

6. Send world units to a position. Send a 0..10 value to a dial.

Warning: `radius` and `diffusion` are build inputs, not live ones.

7. Call the factory again to move one of them, and give the field a new registry.

## The pointer zone is the canvas

Every cursor effect counts the pointer as present only while it is over the canvas of the field.
This holds for the `mode` physics, `parallax`, `trail` and the `spin` drag. The browser hit test
decides. A pointer over a control panel, a header or a card is not over the field. The field
then eases home.

Warning: a canvas with `pointer-events: none` never receives a pointer event.

Give the canvas a transparent background instead, and leave it in the hit test.

Two properties belong to the host. Set `touch-action` on the page, because a drag on a full page
background competes with the page scroll. Set `user-select` on the content behind the canvas,
because a drag that starts on the canvas can still select text.

## The generic formations

Nine factories ship with the engine. Each one takes `count`, a `seed` where there is something
to scatter, and any formation personality field. No factory sets its own `opacity`, `size` or
`chaos`, so the engine defaults apply.

| Factory | Shape |
| --- | --- |
| `curtainFormation` | A full frame scatter that tracks the viewport. `flow` moves it down like rain or right like dust. It wraps, so it never empties. |
| `latticeFormation` | A flat regular grid that faces the camera, in a plane of its own. The build fits that plane into the safe area and never scales it up. It takes no seed. |
| `hourglassFormation` | Two bells joined by a narrow waist. The sand falls through the waist, and a grain that leaves the bottom re-enters at the top. It lies in a plane of its own and fits it on the same rule as the lattice. |
| `cloudFormation` | A volumetric scatter, uniform by volume inside a sphere and squashed in z. It therefore looks like a slab and not a ball. `lobes` remaps it to the frame shape. |
| `horizonFormation` | A ground plane that recedes from the camera. It sets `floor` by default, so the cursor physics slide the points along the ground. |
| `streamFormation` | A horizontal river across the viewport. It is a funnel: wide at both mouths and pinched to `waist` through the middle. |
| `dnaFormation` | A centered double helix with two strands, twelve rungs and a live scroll along the axis. It ignores the viewport. |
| `flowerFormation` | A wheel of seven teardrop petals on a shallow convex dome. Absent a `radius`, it sizes from the shorter side of the safe area. |
| `veinsFormation` | A branched network of 21 vessels in three dimensions. Each point travels its route from trunk to tip and wraps back. |

### The options of each factory

Everything past `count` has a default that reproduces the shape above. The units are world units,
except the fractions and the dials.

| Factory | Its own options |
| --- | --- |
| `curtainFormation` | `flow` `"none" \| "down" \| "right"` (`"none"`), `speedMin` `0.18` and `speedMax` `0.48` world units a second, `spanX` `1.02` and `spanY` `1.08` as fractions of the world width and height of the viewport, `depth` `1.4`, `seed` `1` |
| `latticeFormation` | `cols` `100` (the rows follow from the count), `width` `11.2` and `height` `7.2` (the plane where there is room for it, its proportions where there is not), `z` `-1.8` |
| `hourglassFormation` | `height` `5.2`, `width` `3.6` at the rims, `waist` `0.1` as a fraction of that width, `speedMin` `0.2` and `speedMax` `0.5` in bell to bell travels a second, `depth` `0.3`, `seed` `1` |
| `cloudFormation` | `radius` `3.6`, `depthScale` `0.5`, `z` `-1.2`, `lobes` `false`, `diffusion` `5`, `seed` `1` |
| `horizonFormation` | `cols` `120`, `width` `15`, `depth` `8`, `z` `-5.2` at the near edge, `y` `-1.65` for the ground height, `radius` (absent, which is the 8.5 that the default footprint reaches), `diffusion` `5`, `seed` `1` |
| `streamFormation` | `waist` `0.34` as a fraction of the height of the mouths, `seed` `1` |
| `dnaFormation` | `radius` (absent, about 2.17 as built), `diffusion` `5`, `seed` `1` |
| `flowerFormation` | `radius` (absent, sized from the shorter side of the safe area), `diffusion` `5`, `seed` `1` |
| `veinsFormation` | `radius` (absent, about 2.21 as built), `diffusion` `5`, `seed` `1` |

Four factories own their motion and say so in their types. `hourglassFormation`,
`streamFormation`, `dnaFormation` and `veinsFormation` take every personality field except
`live`. The fall, the current, the scroll and the flow are their own `live` callback. The other
five accept a `live` callback from the host. At `flow: "none"` the `curtainFormation` runs the
`live` callback that you give it.

### radius and diffusion

Every 3D formation takes `radius` and `diffusion`. The meaning and the world units are the same
as for a sampled geometry. `cloudFormation`, `horizonFormation`, `dnaFormation`,
`flowerFormation` and `veinsFormation` all answer both. `radius` is the reach of the object from
its own center, in world units. `diffusion` is the 0..10 dial for how far a point sits off its
surface: 0 is crisp, 5 is the tuned 0.02 world units, 10 is the softest 0.12.

The four flat fields take neither. `curtainFormation`, `latticeFormation`, `streamFormation` and
`hourglassFormation` scatter across the live viewport or lie in a plane of their own. They take
their own geometry instead: spans, columns, a width, a height, a rim width and a waist.

`radius` has three special meanings. On `cloudFormation` it is the sphere before the `lobes`
remap. On `horizonFormation` it is the far corner of the footprint, 8.5 at the default 15 by 8.
On `veinsFormation` the engine measures it off the grown tree, about 2.21 as it ships.

## The three.js adapters

`geometryFormation` wraps one `BufferGeometry`. `composedFormation` wraps a list of transformed
geometries. Both sample points uniformly over the surface: an area weighted triangle pick and a
uniform barycentric spread, seeded per point. The same geometry and count always scatter the
same way.

```ts
import * as THREE from "three";
import { composedFormation, geometryFormation } from "@0backlog/nebula";

const knot = geometryFormation(new THREE.TorusKnotGeometry(1.35, 0.42, 220, 32), {
  count: 9000,
  radius: 2.4,
  opacity: 0.36,
});

// a part carries its own transform and its own density weight
const flower = composedFormation(
  [
    { geometry: new THREE.SphereGeometry(0.5, 20, 14), at: [0, 1.6, 0], weight: 1.6 },
    { geometry: new THREE.CylinderGeometry(0.045, 0.06, 2.4, 10), at: [0, 0.1, 0], weight: 0.8 },
  ],
  { count: 9000, radius: 2.3, opacity: 0.36 },
);
```

Both factories take the same options (`ShapeOpts`), plus any formation personality field.

| Option | Type | Default | What it does |
| --- | --- | --- | --- |
| `count` | `number` | required | The points sampled over the surface. It is prefix stable, so a larger count leaves every existing point in place. |
| `radius` | `number` | `2.2` | The engine scales the merged shape to fit this world radius. |
| `y` | `number` | `0.1` | The vertical center offset, in world units. |
| `diffusion` | `number` 0..10 | `5` | How far the points scatter off the surface. 0 is crisp, 5 is the tuned 0.02 world units, 10 is the softest 0.12. |
| `seed` | `number` | `1` | It shifts every hash stream, so two shapes of one geometry scatter differently. |

A part of a composition (`ShapePart`) is a geometry plus its place and its density.

| Field | Type | Default | What it does |
| --- | --- | --- | --- |
| `geometry` | `THREE.BufferGeometry` | required | The surface that this part samples. The engine caches the triangulation per geometry. |
| `at` | `[x, y, z]` | origin | Where the part sits. The engine then recenters the merged shape and scales it to `radius`. |
| `rot` | `[x, y, z]` | none | Radians, applied tilt then azimuth, Euler order YXZ. |
| `scale` | `number \| [x, y, z]` | `1` | Uniform or per axis. It does not re-weigh the share of the points that the part takes. |
| `weight` | `number` | `1` | The density on top of the surface area of the part. |

`weight` has a large effect. The sample step is area weighted, so a small dense part receives
almost no points until you raise its weight.

Warning: `diffusion` is a build input, not a live one. The engine bakes it into the positions.

To move `diffusion`, call the factory again and give `DsField` a new registry. The rebuild has a
low cost and is safe. Every point keeps its own surface anchor, so the engine takes the result
into the live field with no remount.

`sampleGeometrySurface(geometry, count, seed)` returns the raw points with no formation around
them. It adds no diffusion of its own.

## The talking face

`faceFormation` samples a MediaPipe style landmark mesh. It keeps the triangle and the
barycentric coordinates of each point. It then derives the position from the current landmarks
every frame. The face is therefore not a baked pose: move the jaw landmarks and the points on
the jaw follow.

```tsx
import { DsField, faceFormation } from "@0backlog/nebula";

const formations = { face: faceFormation({ count: 12000, radius: 2.2, opacity: 0.36 }) };

<DsField formations={formations} formation="face" tint="#fafafa" glow />;
```

Warning: without the `glow` prop the face shows none of its own light work.

Set `glow` on `DsField` for every face. The face uses its `glow` callback to hold the flat
plates back and to light the mouth as it opens.

| Option | Type | Default | What it does |
| --- | --- | --- | --- |
| `count` | `number` | required | The points sampled over the landmark mesh. It is prefix stable. |
| `asset` | `FaceAsset` | the neutral face | 468 MediaPipe landmarks plus a triangulation. |
| `radius` | `number` | `2.2` | The engine scales the head to this world radius. |
| `y` | `number` | `0.05` | The vertical center offset, in world units. |
| `diffusion` | `number` 0..10 | `5` | 0 is crisp, 5 is the tuned 0.008 world units, 10 is the softest 0.05. The face tops out far below the 0.12 of a shape, because a head carries its silhouette in small features. |
| `seed` | `number` | `1` | It shifts every hash stream. |

With nothing to drive it the face breathes and blinks on a deterministic clock. There are two
ways to make it speak.

### Speech from an audio element

Warning: a browser resumes an `AudioContext` only from a user gesture.

Warning: after an element goes through the analyser, its sound reaches the speakers only through
the audio context. A missed `resumeFaceAudio` call is silence.

1. Call `attachFaceAudio(el)` in the same event handler that starts playback.
2. Call `resumeFaceAudio()` in that same handler.
3. Start playback.

```ts
import { attachFaceAudio, resumeFaceAudio } from "@0backlog/nebula";

// on the SAME user gesture that starts playback: a browser only resumes an
// AudioContext from a gesture
function onPlayClick(el: HTMLAudioElement) {
  attachFaceAudio(el);
  resumeFaceAudio();
  void el.play();
}
```

The analyser splits the voiced range around the first and the second formant. It therefore
shapes the mouth per vowel class. Open vowels drop the jaw further. The front vowels i and e
stretch the corners. The rounded back vowels o and u purse them. Each band normalizes into an
adaptive window. The level of speech swings much more than the low end of a mastered track.

A browser makes a `MediaElementAudioSourceNode` one time per element, ever. `attachFaceAudio` is
therefore safe to call more than one time for one element, and safe across a remount.

### Speech from a voice agent

`setFaceDrive` is the integration point. A text to speech stream calls it as the chunks arrive,
at whatever rate it has data.

```ts
import { clearFaceDrive, setFaceDrive } from "@0backlog/nebula";

for await (const chunk of ttsStream) {
  play(chunk);
  setFaceDrive({ open: amplitudeOf(chunk) });
}
clearFaceDrive(); // end of utterance: closes the mouth
```

The three drive channels are the `FaceDrive` type. Each one is an absolute 0..1 value, not a
dial.

| Channel | Meaning |
| --- | --- |
| `open` | The jaw aperture. 0 is closed and 1 is wide. |
| `spread` | The lip corner spread. 0 is neutral and 1 is the wide i and e stretch. |
| `round` | The lip round. 0 is neutral and 1 is the pursed o and u shape. |

`setFaceDrive(patch)` takes a partial patch. A push of `{ open }` alone leaves `spread` and
`round` as they were. An external push has priority over the analyser for 0.35 seconds. The
engine then eases back to the analyser. A dropped stream therefore closes the mouth and does not
freeze it open. `clearFaceDrive()` ends the utterance.

### The gesture dials and the gain

`setFaceGesture({ jaw, lips, blink })` shapes the delivery. All three are 0..10 dials with 5 at
the tuned nominal.

| Dial | 0 | 5 | 10 |
| --- | --- | --- | --- |
| `jaw` | no travel | the tuned travel | double the travel |
| `lips` | no travel | the tuned travel | double the travel |
| `blink` | stopped, and a mid blink lid eases open | the tuned rate | three times the rate |

`setFaceDriveGain(g)` sets the sensitivity of the analyser path on the same 0..10 scale, from 0
to 1 to 3. It scales the shaped mouth outputs, so it survives the adaptive window. A
`setFaceDrive` push stays absolute.

### A custom face

The neutral face is `src/field-face-neutral.json`, plain data you can open and compare your own
asset against. The build also copies it next to the bundle.

Warning: a corrupt asset must not reach the formation.

Send every asset through `parseFaceAsset` first. It returns `null` instead of a throw, so a
corrupt payload degrades to the neutral face.

```ts
import { faceFormation, parseFaceAsset, type FaceAsset } from "@0backlog/nebula";

const stored = localStorage.getItem("my-app.face");
const asset: FaceAsset | null = stored ? parseFaceAsset(JSON.parse(stored)) : null;
const face = faceFormation({ count: 12000, asset: asset ?? undefined });
```

Face space is +x to the right of the viewer, +y up, and +z toward the viewer. The center is the
bounding box of the landmarks. The scale puts the furthest landmark at radius 1. Normalize your
asset the same way and the formation scales it by one world radius.

The lower level toolkit is public too: `buildDeformWeights`, `FACE_REGIONS`, `MOUTH_TRAVEL`,
`SPREAD_TRAVEL`, `ROUND_TRAVEL`, `toFaceGeometry`, `DEFAULT_FACE`, `FACE_LANDMARK_COUNT`,
`FACE_FEATURE_WEIGHT`, `FACE_FEATURE_PEAK`, `FACE_FEATURE_PLAIN`, and the `FaceAsset`,
`FaceGeometry` and `FaceDeform` types. A landmark pipeline can build and validate assets with
them and never import the engine.

### One face at a time

Warning: the talk state, the landmark deltas and the audio context are module level singletons.

Show one face per page. Two `DsField` instances that show a face share one mouth. The per frame
path must not allocate or look anything up, so this limit is deliberate.

## The host callbacks

The field calls `energy`, `gather` and `orient` once per frame.

### energy

`energy(dt)` returns a raw 0..1 signal, not a dial. The engine gives it the frame delta in
seconds. The whole field pulses and trembles in time with the value. The source of the number is
the concern of the host. A host commonly feeds it the low end envelope of a soundtrack.

### gather

`gather()` returns a world space attractor or `null`. The points pool toward the position with a
smooth falloff and trail it when it moves.

| Field | Scale | Meaning |
| --- | --- | --- |
| `x`, `y` | world units | The position of the attractor. |
| `s` | dial 0..10 | The pull. 5 is the nominal half strength. An absent `s` pulls at full strength. |
| `r` | raw multiplier | The falloff spread. 1.6 reproduces the default spread, and a smaller value pools the points tighter. |

### orient

`orient()` returns a target pose for the whole field or `null`. `rx` and `ry` are radians. The
engine eases toward the target. `speed` is a 0..10 dial on the ease rate. 0 is a slow drift and
10 is near instant. The engine still smooths the pose at 10. An absent `speed` uses the same
rate as the sway.

The pose composes with the `spin` drag. The turn of the user adds to the target. A field that
the user spins therefore still moves toward the pose of the host.

### Screen coordinates to world units

Warning: `gather` and the spotlights speak world units. A screen pixel in either payload lands
far off target.

1. Read the exported camera numbers from `FIELD_CAMERA` (`z` is 8.2 and `fov` is 45).
2. Compute the world height at the z = 0 plane.
3. Scale the width by the aspect of the canvas rect.

```ts
import { FIELD_CAMERA } from "@0backlog/nebula";

const worldH = 2 * FIELD_CAMERA.z * Math.tan((FIELD_CAMERA.fov * Math.PI) / 360);
const worldW = worldH * (rect.width / rect.height);
const x = ((clientX - rect.left) / rect.width - 0.5) * worldW;
const y = -((clientY - rect.top) / rect.height - 0.5) * worldH;
```

The engine maps both payloads through the current pose of the field every frame. The attractor
and the light therefore hold their world position under `parallax`, `orient`, the `spin` drag
and `fit`.

## Spotlights

A spotlight is a light pocket. The points near the world position brighten on a gaussian
falloff with no hard edge. The field takes up to four pockets and ignores the extras.

| Field | Type | Default | What it does |
| --- | --- | --- | --- |
| `x`, `y` | `number` | required | The world position of the pocket. |
| `z` | `number` | `0` | The depth of the pocket, in world units. |
| `intensity` | `number` 0..10 | `5` | 0 is off, 5 lifts the center to 2.5x brightness, 10 lifts it to 6x. |
| `radius` | `number` 0..10 | `5` | The gaussian falloff: 0.2 world units at 0, 1.1 at 5, 3 at 10. |
| `tint` | `string` | none | A CSS color for the light. Absent, the pocket only brightens. |

The pockets compose. The boosts add, so a point inside two pockets takes light from both, and
the tints mix in list order. The engine multiplies the boost into the per point path that a
formation `glow` callback writes. A formation that glows therefore keeps its own shape under the
light. The `spotlights` prop turns the per point material on by itself, exactly as `glow` does.

Give a callback instead of an array to re-aim the pockets every frame. Drop a pocket with a
`null` entry, a shorter list or a `null` return. The engine then eases the pocket out instead of
a snap. Entry k keeps its own ease, so a stable list order means that each light eases where it
stands. An empty array, a `null` entry and an absent prop are all no light, at no cost.

Warning: the boost multiplies the alpha of the point, and alpha saturates at 1.

Keep `formation opacity * intensity * gain` below 1 for the full ratio. At the defaults (opacity
0.3 and `intensity` 5) the limit lands near dial 6.4. Past it the light widens instead of
brightens. Dim the formation or lower `intensity` to use the top of the dial.

A `tint` makes the pocket colored light. The points inside it shift from the field `tint` toward
the pocket color. The weight is the same gaussian that sets their brightness: the full color at
the center and nothing at the edge. The shader computes that weight from the position that the
brightness already used. A tint therefore costs no extra per point work. It works under both
blend modes. It fades in and out on the presence ease of the pocket. An `intensity` of 0 with a
`tint` set is a pocket that colors and does not brighten.

## The safe area inset

`inset` takes the CSS pixels of each canvas edge that something else covers. A floating card, a
header or a side panel covers an edge. The engine subtracts them from the usable area and
centers the field in what is left. A formation then sits in the middle of the space that a
person sees.

```tsx
// a 420 px rail of cards down the left, a 96 px header: the cloud centers in
// the rest, 210 px right of the canvas center and 48 px below it
<DsField formations={formations} formation="cloud" tint="#fafafa"
         inset={{ left: 420, top: 96 }} />
```

Only the difference between two opposite edges moves the field. A `left` of 420 alone shifts the
field 210 pixels right. A `left` and a `right` of 420 centers the field again.

The shift composes with everything that already moves the field. `parallax` drifts around the
shifted home. The `spin` drag turns the field about its own origin, which is what this shift
moves. The pointer and the light pockets still land where the host aims them. Both come back
through the position of the group.

The engine converts the pixels at the z = 0 plane. A formation well behind that plane shifts a
little less on screen than the number says. A `cloudFormation` at z = -1.2 is such a formation.
The shift lands whole on the first frame and follows a resize. An absent `inset` costs one
branch a frame.

The safe area is a rectangle, not only a shift. The engine therefore gives all four of its
numbers to every build. `vp.sw` and `vp.sh` are its size in world units. `vp.sx` and `vp.sy` are
its middle, measured from the middle of the canvas. A formation that is laid out rather than
scattered reads the size. Its edges then land where a person can see them. A formation that is
meant to bleed off the canvas edges keeps `vp.ww` and `vp.wh`.

`latticeFormation` and `hourglassFormation` read the size already. Each one scales its plane
down until the plane fits, and keeps its own proportions while it does. Neither one scales the
plane up past the `width` and the `height` that you give it.

Warning: the engine has already moved the field to `vp.sx`, `vp.sy`.

Never add that pair again in a build that lays out around its own origin. Use it only for a
formation that is laid out at a depth of its own.

## The mobile budget and the cost per frame

`mobile` is the phone point budget. Below 768 CSS pixels of canvas width the shown count scales
by `mobile` / 10. It is a plain fraction, not a dial curve. The trimmed field strides through
the build and does not cut the tail. The shape therefore thins and does not crop. The engine
applies the budget where the target count resolves. A change therefore morphs like any other
count change. The engine recomputes the budget on the debounced resize.

Warning: `mobile` at 0 shows nothing at all on a phone.

- Point count. 9000 points is a safe full screen default. 15000 is the tested ceiling. The per
  frame cost is the position buffer upload, which is linear in the shown count.
- Device pixel ratio. It is 1 on a coarse pointer and up to 1.75 elsewhere. A phone GPU with
  1.75x pixels on top of a per frame buffer upload is the case that drops frames.
- Reduced motion. Under `prefers-reduced-motion: reduce` the resting breath, the beat pulse, the
  tremble, the drag inertia and the trail are off. Morphs snap. The frame loop drops to
  `demand`, so an idle field does no work.
- High refresh displays. Every per frame ease is delta correct. A 120 Hz display therefore
  matches the tuned 60 fps feel.
- Hidden tab. The loop stops on `visibilitychange` and resumes cleanly.
- Build cost. Formations build lazily, one time per viewport. Only the formations that the host
  visits pay. The engine debounces a viewport change by 150 ms.
- The shader path. `shine`, `round`, `additive` above 0, `glow` and `spotlights` all use a small
  custom material. It matches the plain one when every amount is 0. `round` defaults to 10, so
  the shader path is the normal path. It is safe to leave `glow` on for a whole site.

## Browser support

WebGL is necessary. Where WebGL is unavailable the component shows nothing and does not throw.
It is unavailable when a browser blocks it, when the run is headless, or when the GPU is too
old.

Warning: plan for a field that is simply not there.

Never put content inside the field.

Web Audio is necessary for `attachFaceAudio` only. Without it, playback still works and the face
stays idle. `setFaceDrive` still works, because it never touches the audio graph.

## Common mistakes

| Mistake | What you see |
| --- | --- |
| The host makes the registry inside the render function. | Every formation rebuilds on every host render. The frame rate falls and the morph restarts. |
| One formation object serves two canvases. | One of the two fields wraps its points at the wrong edge, or the points jump. |
| Formations have different counts and `capacity` is absent. | A large formation shows only the length of the first build. Its shape looks cut. |
| `capacity` changes after mount. | Nothing changes. The engine fixes the buffer at mount. |
| `formation` names a key that the registry does not carry. | The first registered formation shows, and there is no error. |
| The parent box has no height. | The canvas is empty. |
| The canvas has `pointer-events: none`. | `mode`, `parallax`, `trail` and the `spin` drag all do nothing. |
| A 0..1 fraction goes to a dial, such as `intensity={0.5}`. | The field is almost invisible. 0.5 on the dial is near the minimum. |
| A 0..10 value goes to a formation `opacity`. | The field is a solid block of color. |
| A screen pixel goes to `gather` or to a spotlight. | The attractor or the light sits far off the canvas. |
| `diffusion` or `radius` moves with no new factory call. | The shape does not change. Both are build inputs. |
| The face runs without the `glow` prop. | The mouth does not light and the flat plates stay bright. |
| `resumeFaceAudio` is missing, or the calls are not on a user gesture. | The element plays but there is no sound, and the mouth stays closed. |
| Two fields show a face on one page. | Both faces speak with one mouth. |
| A build calls `Math.random` or `Date.now`. | A resize scatters the whole field again and turns into a full morph. |
| A `live` callback allocates a new array per point. | The frame rate drops every few seconds. |
| A `live` callback returns the pair form on a shape with depth. | The shape breaks apart within seconds under `orient`. |
| A per point table has the capacity as its length, not the count of the formation. | Points disappear. A read past the table writes NaN into the buffer. |
| A build adds `vp.sx` and `vp.sy` to its own positions. | The formation moves twice as far as the `inset` asks, and it leaves the safe area. |

## The exports

- Engine: `DsField`, `dial10`, `fieldHash01`, `FIELD_CAMERA`.
- Types: `DsFieldProps`, `FieldFormation`, `FieldCursorMode`, `FieldViewport`, `FieldLiveCtx`,
  `FieldSpotlight`, `FieldInset`.
- Generic formations: `curtainFormation`, `latticeFormation`, `hourglassFormation`,
  `cloudFormation`, `horizonFormation`, `streamFormation`, `dnaFormation`, `flowerFormation`
  and `veinsFormation`. Each one has a matching options type: `CurtainOpts`, `LatticeOpts`,
  `HourglassOpts`, `CloudOpts`, `HorizonOpts`, `StreamOpts`, `DnaOpts`, `FlowerOpts` and
  `VeinsOpts`.
- Shapes: `geometryFormation`, `composedFormation`, `sampleGeometrySurface`, `ShapeOpts`,
  `ShapePart`.
- Face formation: `faceFormation`, `FaceFormationOpts`.
- Face drive: `attachFaceAudio`, `resumeFaceAudio`, `setFaceDrive`, `clearFaceDrive`,
  `setFaceDriveGain`, `setFaceGesture`, `FaceDrive`.
- Face asset: `parseFaceAsset`, `toFaceGeometry`, `buildDeformWeights`, `DEFAULT_FACE`,
  `FACE_REGIONS`, `FACE_LANDMARK_COUNT`, `FACE_FEATURE_WEIGHT`, `FACE_FEATURE_PEAK`,
  `FACE_FEATURE_PLAIN`, `MOUTH_TRAVEL`, `SPREAD_TRAVEL`, `ROUND_TRAVEL`, `FaceAsset`,
  `FaceGeometry`, `FaceDeform`.

## More

To write a formation of your own, read `reference/custom-formations.md`. It carries the
`FieldFormation` fields, the determinism contract and a complete example.
