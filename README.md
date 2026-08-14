# nebula

![license](https://img.shields.io/badge/license-MIT-black) ![fork it](https://img.shields.io/badge/fork%20it-it%20is%20yours-black)

A WebGL point field for React that morphs, reacts and talks. One component, one canvas, one
persistent cloud of up to 15000 points that takes the shape of whatever formation you name: it
multiplies, thins, regroups and changes behavior wherever the surface asks it to. Formations
are content, so this holds the engine plus nine generic ones, an adapter that turns any
three.js `BufferGeometry` into a formation, and a talking face driven by speech. Use it as a
background that answers the pointer, as a shape a page morphs through as it scrolls, or as the
face of something that speaks. It was extracted from a production site where it is the whole
visual identity, and the extraction is faithful: same math, same prop names, the same tuned
nominals.

### [Try it live at 0backlog.com/nebula](https://0backlog.com/nebula)

Every formation and every dial in one page: pick a shape, drag it, light it, play something at
it. It is `examples/demo` deployed as it stands.

## Take it

There is no install command, because there is nothing to install. This is not on npm and is
not meant to be a black box you depend on: fork it, or copy `src/` into your own project, and
the whole thing is yours to change.

```sh
git clone https://github.com/0backlog/nebula
cd nebula
pnpm install
pnpm demo      # builds it, then serves examples/demo on http://localhost:5173
```

To use it in an app of your own, drop `src/` in (a small core plus the organ files it names,
and the formations you actually want) and add the three things it expects to find:

```sh
npm install three @react-three/fiber
npm install -D @types/three
```

`react`, `react-dom`, `three` and `@react-three/fiber` are peers: the engine imports them and
never bundles them, so your app's copies are the ones that run. three 0.163 or newer is
required, because the dot shader assumes the WebGL2-only renderer and the WebGL1 fallback that
r160 to r162 still carried would fail to compile it. TypeScript 5.7 or newer, and `@types/three`
alongside it: three ships no types of its own and `@react-three/fiber` does not pull them in.

Everything here is ESM and browser only. `src/field.tsx` carries a `"use client"` directive, so
it drops into a React Server Components app without a wrapper of its own.

**What to take.** `src/field.tsx` is the core: the frame loop, the morph and the contract. The
organs it composes each live in their own small file next to it, named for what they are:
`field-units` (the dial, the hash, the shared eases), `field-viewport` (the safe area),
`field-shader` (the dot mark), `field-pointer` (the canvas pointer zone), `field-cursor` (the
cursor physics), `field-drag` (drag to spin), `field-spot` (the light pockets). The core needs
all of them as shipped, but each concern reads whole in one file, and cutting one out of a fork
is deleting the file and the few call sites that name it. Beyond the engine, everything is
optional and separable: `src/formations.ts` is nine shapes you can take one at a time,
`src/field-shapes.ts` turns three.js geometries into formations, and the three `field-face-*`
files are the talking head. `src/sampling.ts` is shared by the last two.

## Minimal example

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

The import path above is what this repository uses for itself (`examples/demo` resolves the
engine by name through the workspace). In a fork of your own it is wherever you put `src/`.

The component renders its own `<Canvas>` and fills its parent, so give it a sized box. It
mounts already wearing the initial formation's opacity and size, so the first second does not
visibly ease down from a constant.

In a Next.js App Router project, note what the engine's own `"use client"` directive does and
does not buy you. It means the engine needs no wrapper file of its own: importing it never
makes you write a one line client component to re-export it. It does NOT make `DsField`
renderable from a server component, because the required `formations` prop carries functions
and functions cannot cross the server boundary. So the module that builds the registry and
renders the field is a client module, as above.

## Every dial is 0..10

One scale runs the whole surface: 0 is the minimum, 10 the maximum, and 5 is ALWAYS the
nominal tuned value. It covers `shine`, `round`, `additive`, `trail`, `intensity`, `parallax`,
`spin`, `transition` and `shuffle` on the component, `size`, `chaos`, `cursorReach` and
`cursorForce` on a formation, `diffusion` on every 3D formation and on the face, `gather`'s
`s`, `orient`'s `speed`, a spotlight's `intensity` and `radius`, and the face's gesture dials.
On a formation an absent dial sits at 5, so you only pass what you are moving; component
defaults are per prop (the effects that start off default to 0) and the table below carries
each one.

`dial10(v, min, nominal, max)` is the one mapping and it is exported: 0..5 spans min to
nominal, 5..10 spans nominal to max, piecewise linear, input clamped. Every dial resolves
through it at the component boundary, so the engine past that line speaks internal units only,
and a host that needs the same curve for its own knob can call it.

Not everything is a dial, on purpose. A formation's `opacity` is a plain 0..1 material value,
`energy`'s callback returns a raw 0..1 signal (a measurement, not a setting), `mobile` is a
plain fraction of the point count, the positions in `gather`'s and the spotlights' payloads are
world units, a formation's `radius` is world units too (the reach it is built to), `inset` is
css px of the canvas, and `gather`'s `r` is a raw multiplier on the falloff spread (1.6 the
whole page default), not a dial.

## DsField props

| Prop | Type | Default | What it does |
| --- | --- | --- | --- |
| `formations` | `Record<string, FieldFormation>` | required | The registry. Keep the object identity stable: a new object rebuilds every formation. |
| `formation` | `string` | required | Which key is up. Changing it morphs the whole cloud, staggered per point. An unregistered key falls back to the first registered formation rather than freezing the canvas. |
| `tint` | `string` | required | Any CSS color. Applied live and EASED: a color change glides through RGB at the same rate the opacity does, so recoloring the cloud is a transition rather than a repaint. `shine`, `round` and `additive` ease the same way, and the blend mode follows the eased halo, so every look input lands as motion, never as a step. |
| `mode` | `"repel" \| "attract" \| "vortex" \| "off"` | `"repel"` | Cursor physics. `"off"` stops the dot physics only; the pointer drift is `parallax`'s own dial. The field only responds while the pointer is over its own canvas, and the influence is eased rather than cut: it ramps in as the pointer arrives, relaxes out where the pointer was last seen (leaving the canvas, crossing onto content stacked over it, or the mode flipping to `"off"`), and a change between two live modes dips through that ease before the new physics take over, so a displaced cavity always releases as motion instead of snapping. Every mode's influence is radial and falls to exactly nothing at its own rim, flat at both ends of the curve, so there is no ring around the pointer where the effect stops. No mode can fold the field over itself either: `attract` and `vortex` move a dot by a share of its own distance from the pointer rather than by a fixed distance, and `repel`'s push scales down with a reach narrower than the nominal, so the order of the dots along the radius survives every combination of `radius` and `force`. Two dots never land on top of each other, which is what a bright ring or a hard edged clump under the pointer would be. |
| `shine` | `number` 0..10 | `0` | Per point shimmer, off at 0. 5 is the classic twinkle, 10 flickers three times as hard. Its tempo sits well above the resting breath, so shimmer and motion never read as one coupled thing. |
| `glow` | `boolean` | `false` | Not a dial. Render with the per point material so a formation's `glow` hook can light individual dots. Identical to the plain material when nothing glows, so it is safe to leave on. |
| `round` | `number` 0..10 | `10` | Corner rounding of the mark: 0 a hard square, 5 the nominal rounded corners, 10 a circle. The circle is the resting mark, hence the default. |
| `additive` | `number` 0..10 | `0` | Above 0 the blending flips to additive and a soft halo dials in, edge falloff plus an overdriven core. 5 is the nominal half halo, 10 the full glow. |
| `trail` | `number` 0..10 | `0` | Cursor drag trail: 5 a half strength wake, 10 the full elastic drag. Physics, not sprites: swept points pick up the cursor's velocity and spring home. Inert on floor formations and under reduced motion. |
| `intensity` | `number` 0..10 | `5` | Scales every formation's resting opacity: 5 leaves each formation's own tuning alone, 0 blacks the cloud out, 10 triples it. Useful over a light background. |
| `parallax` | `number` 0..10 | `5` | Pointer following drift of the whole cloud: 0 off, 5 the tuned lean, 10 half again as far. A pure group translation, no re aim, so it reads on flat formations too, and it eases home when the pointer leaves the canvas. Independent of `mode`. |
| `inset` | `{ left?, right?, top?, bottom? }` | none | The SAFE AREA, and not a dial: css px of the field's own canvas that are spoken for by something stacked over it, a floating card, a header, a side panel. The engine subtracts them from the usable area and centers the cloud in what is LEFT, so a formation sits in the middle of the space a person actually sees rather than in the middle of a full bleed canvas. Only the difference between opposite edges moves the middle, but the SIZE that is left reaches every build too, so a formation laid out in a plane of its own (the lattice, the hourglass) fits that plane into the gap rather than running on under the cards. It composes with `parallax` and the `spin` drag, lands whole on the first frame, follows a resize, and costs one branch a frame when absent. |
| `spin` | `number` 0..10 | `5` | Drag to spin. How the cloud answers a drag on its own canvas: horizontal turns it around y, vertical around x, and letting go leaves it turning with inertia until it eases to rest. 5 is the natural feel, the shape following the pointer about one to one (a drag across the full canvas width is half a turn) and coasting about a second; 10 is loose, twice the travel and a much longer coast; 0 turns dragging off entirely, the canvas never captures a pointer, and any turn already in the cloud eases back to zero instead of staying where the hand left it, so a host that drops the dial to 0 for its flat formations gets a curtain facing the viewer rather than a tilted plane. The turn ADDS to `orient` rather than replacing it, and every world space payload (the `spotlights`, the cursor physics, a floor, the `trail`) comes back through it. There is no autonomous spin: the cloud only turns when the user turns it. |
| `transition` | `number` 0..10 | `5` | How long a morph between formations takes: 5 is the tuned 1.15 seconds, 0 the slowest useful crawl at 6, 10 nearly instant at 0.12. The per point stagger is a fraction of the duration, so even a fast morph arrives point by point. Safe to move mid morph: what stays fixed is the fraction travelled, so the cloud carries on instead of snapping. |
| `shuffle` | `number` 0..10 | `0` | Morph transit scatter: how far each point wanders off the straight line while the cloud travels between formations. 0 is that straight line, every dot moving directly from where it was to where it is going, and it costs nothing. 5 detours the typical point about 0.9 world units at mid transit, a clearly scattered crossing on a frame around 12 units wide; 10 detours it about 2.4, a wide swirl. The detour is drawn from the point's own index, so a morph scatters the same way every time, and it rides an envelope that is exactly zero at both endpoints: however wide the swirl, every dot still lands exactly on its target. |
| `mobile` | `number` 0..10 | `10` | The phone point budget: below 768 css px of canvas width the DRAWN count scales by `mobile`/10, a plain fraction rather than a dial curve. The trimmed field strides through the build instead of cutting its tail, so the shape thins rather than crops. Applied where the target count resolves, so a change morphs like any other count change, and it recomputes on the engine's debounced resize. |
| `energy` | `(dt: number) => number` | none | NOT a dial: a raw 0..1 signal, sampled once per frame with the frame delta. The cloud pulses and trembles in time with it. |
| `gather` | `() => { x, y, r?, s? } \| null` | none | A world space attractor. Points pool toward it with a smooth falloff and trail it when it moves. `s` is a 0..10 dial on the pull (5 the nominal half strength; omitted, it pulls at full strength); `r` scales the falloff spread (a raw multiplier, not a dial): 1.6 matches the whole page default, smaller pools tighter. |
| `orient` | `() => { rx, ry, speed? } \| null` | none | A target pose in radians for the whole cloud, eased toward. `speed` is a 0..10 dial on the ease rate, 0 a slow drift to 10 near instant but still smoothed; omitted, it matches the sway's follow feel. |
| `spotlights` | `FieldSpotlight[] \| (() => (FieldSpotlight \| null)[] \| null)` | none | Up to four light pockets: the points around each world position brighten on a gaussian falloff, and the pockets compose. `intensity` and `radius` are 0..10 dials per pocket, and `tint` (a CSS color, absent by default) makes one colored light instead of plain brightness. Extras past four are ignored; an empty array, a null entry and an absent prop are all no light. |
| `capacity` | `number` | first build's length | Buffer headroom in points. Set it and formations may build different lengths: a count change is births and deaths, never a reshuffle. Grown dots fade in at their own places and shrunk dots fade out where they stand, so a count knob glides instead of remounting or sending part of the cloud flying. |

Some of these deserve more than a row.

**The pointer zone is the canvas.** Every cursor effect (the `mode` physics, `parallax`,
`trail`, the `spin` drag) counts the pointer as present only while it is over the field's OWN
canvas element.
The pointer is tracked from canvas events, so the browser's hit testing decides: a pointer over
a control panel, a header, a card or anything else stacked on top of the field is not over the
field, and the cloud eases home exactly as it does when the pointer leaves the window. The
consequence to know: a canvas the host has set to `pointer-events: none` never sees a pointer
at all, so a background field that has to react under content wants a transparent canvas that
still takes events, not one switched out of hit testing.

**`capacity` is the contract that surprises people.** Without it the buffer is sized by the
FIRST formation's build: later formations that build MORE points are silently clamped to that
length, while formations that build fewer draw (and morph) at their own length. If your
formations have different counts, set `capacity` to the largest of them. Either way capacity
is fixed at mount; changing the prop later does nothing.

**`gather`, `orient` and a callback `spotlights` are sampled every frame.** Keep them stable (a
`useCallback` reading a ref) so scrubbing a slider never remounts the canvas. Gather's and the
pockets' coordinates are world space, and both are mapped through the cloud's
current pose each frame, so the pool and the lights hold their world spot under parallax,
`orient`, the `spin` drag and `fit`: project
a screen position through the exported
`FIELD_CAMERA` numbers the way the demo does (`worldH = 2 * FIELD_CAMERA.z *
Math.tan((FIELD_CAMERA.fov * Math.PI) / 360)`, scaled by the canvas rect) and the attractor, or
a light, lands exactly under the pointer at z = 0.

**Dragging spins the cloud.** `spin` is not a speed, it is a response: nothing turns until a
hand turns it. Press on the canvas and the cloud follows the pointer, horizontal travel around
its y axis and vertical around its x, and on release it keeps the angular velocity it had and
eases to rest. At 5 the shape tracks the hand about one to one (a drag across the full canvas
width is half a turn) and a throw coasts about a second; at 10 the travel doubles and the coast
runs several times longer; at 0 nothing is attached at all, so a host that wants the canvas
drag for itself takes it uncontested. The turn ADDS to `orient`, so a cloud the user has spun
still sways and still eases toward a host's pose, and everything that maps world space into the
cloud (the light pockets, the cursor physics, a floor formation's ground plane, the `trail`
wake) comes back through it, so the field answers where the user points however far it has been
turned. Under reduced motion the drag still works, since the hand is the one moving, but a
release stops the cloud where it was let go of. Two things belong to the host: `touch-action`,
because a drag on a full page background competes with the page scroll, and `user-select` on
whatever sits behind the canvas, because a drag that starts on a canvas can still select text.

**Off is not frozen.** At `spin` 0 the cloud does not merely stop answering the drag, it gives
the turn back: the accumulated angle eases to zero on both axes at the pose ease's own rate,
taking the short way round (a cloud left at 6 radians is a cloud a fifth of a radian short of
home, and it comes back that way), so a shape you turn and come back to unwinds instead of
snapping and a flat formation always ends up facing the viewer. Two seconds from the far side,
frame rate independent, and it snaps to exactly zero at the end so an idle field does no work.
Lowering the dial to 0 mid drag ends the drag on the spot: the listeners come off, the throw is
dropped rather than coasted, and the cloud glides home from wherever it had been turned to.
Under reduced motion the turn is given back at once rather than gliding, since the field is
static there and the loop runs on demand.

**`shuffle` is the transit, not the destination.** At 0 a morph is the shortest thing it can
be: every dot travels the straight line from where it stood to where it is going, and the only
curve in it is the ease, which sets the pace along that line and never bends it. Above 0 each
dot takes a detour drawn from its own index, carried by a bump envelope that peaks at mid
transit and is EXACTLY zero at both ends. That is the whole design: however wide the swirl, the
start pose and the end pose are untouched, so the cloud still lands exactly on the formation
you asked for.

The dial is in world units of detour. 5 pulls the typical point about 0.9 world units off its
line at the peak, which on a frame around 12 units wide is a clearly scattered crossing; 10
pulls it about 2.4, a wide swirl that takes the cloud well past its own silhouette before it
gathers. Being drawn from the index rather than from a random source, one morph scatters the
same way every time it runs, and a point whose start and end coincide (what a count change
leaves behind) stays still rather than shivering: the detour eases off with the square of the
point's own travel, so nothing gets thrown that had nowhere to go.

**`inset` is the safe area, for canvases with things floating over them.** A full bleed canvas
under a couple of floating cards has a problem no formation can solve on its own: the engine
centers the cloud on the CANVAS, and a person reads the empty space between the cards as the
frame, so a perfectly centered formation looks off center. Pass the css px each edge is losing
and the engine subtracts them from the usable area and centers the cloud in what is left, by
shifting the whole group.

```tsx
// a 420 px rail of cards down the left, a 96 px header: the cloud centers in
// the rest, 210 px right of the canvas center and 48 px below it
<DsField formations={formations} formation="cloud" tint="#fafafa"
         inset={{ left: 420, top: 96 }} />
```

Only the DIFFERENCE between opposite edges moves the middle: 420 on the left alone shifts the
cloud 210 px right, and 420 on both sides is centered again. The shift composes with everything
that was already moving the cloud: `parallax` leans around the shifted home rather than around
the canvas center, and the `spin` drag turns the cloud about its own origin, which this is.
Everything that maps world space in (the light pockets, `gather`, the cursor physics) already
comes back through the group's position, so the pointer still lands where it points and a light
pocket still sits on the world spot it was aimed at. It lands whole on the first frame instead
of gliding in from the center, and it follows a resize on the frame that resize happens. The px
are converted at the z = 0 plane, the plane the engine treats as the cloud's, so a formation
sitting well behind it (a `cloudFormation` at z = -1.2, say) moves a touch less on screen than
the number says. Absent, it costs one branch a frame.

**A safe area is a size, not only a middle**, and moving the cloud is only half of the answer:
no position makes an object wider than the gap between two cards fit between them. So the size
that is left rides on the viewport every `build` is handed, as `sw`/`sh` (with `sx`/`sy` for the
middle), and the formations that are LAID OUT rather than scattered fit themselves into it:
`latticeFormation` and `hourglassFormation` scale their plane down until it clears the cards,
keeping their own proportions, and never scale up past the geometry they were given. They
correct for their own depth while they are at it, which is the part the group shift cannot do:
a plane standing behind the origin covers more world for the same screen, so it is built wider
than the safe area reads, and moved the extra distance the group shift left it short of. A
field that is MEANT to bleed off the canvas edges, the curtain and the stream, reads `ww`/`wh`
and is untouched by any of it.

A frame with nothing declared over it is its own safe area, so the same fit answers a narrow
frame: the lattice's shipped 11.2 by 7.2 at z = -1.8 covers the canvas out to about 1.35 to 1,
and below that (a portrait phone, a squarish window) the grid stops at the sides rather than
running past them with its outer columns cropped. That is the difference between a laid out
field and a scattered one, not a special case. The hourglass at 3.6 by 5.2 has room on any
frame and only ever moves for a real inset.

**Light pockets, up to four.** Pass an array of `{ x, y }` (plus `z`, default 0) and the points
near each position brighten on a gaussian falloff with no hard edge: `intensity` 5 lifts the
center to 2.5x, 10 to 6x, 0 turns it off, and `radius` runs 0.2 world units at 0, 1.1 at 5, 3 at
10. They COMPOSE: the boosts add, so a point sitting in two pockets is lit by both.
The lift is on the point's alpha and alpha saturates at 1, so the ratio holds only while the
formation's opacity times `intensity` times the gain stays under it. At the defaults (opacity
0.3, presence 5) that is around dial 6.4, and above it the light widens instead of brightening.
Dim the formation or lower `intensity` if you want the whole dial.
They brighten through the same per point path a formation's `glow` hook writes and MULTIPLY
into it, so a glowing formation keeps its own shape under the light; passing `spotlights`
switches that per point material on by itself, exactly as `glow` does. Pass a callback instead
of an array to re aim them every frame, and drop a pocket (a `null` entry, a shorter list, a
`null` return) to ease it out instead of snapping it. Entry k keeps its own smoothing, so a
stable list order means each light eases where it stands. An empty array, a null entry and an
absent prop are all no light, at no cost.

Add `tint` (any CSS color) to a pocket and it becomes COLORED light. Points inside it lean from
the field's own `tint` toward that color by the same gaussian weight that sets their brightness:
the full color at the center, nothing at the edge, so it reads as light falling on the cloud
rather than as a recolored region with a border. Two tinted pockets mix in list order, each
leaning the running color the rest of the way by its own weight, so a point under both takes
color from both. The shader computes those weights from the very positions the brightness used,
so a tint adds no per point work and no buffer traffic, and it
behaves under both blendings (additive adds colored light, normal paints it). It fades in and
out on the pocket's own presence ease, so setting, changing or clearing it mid flight glides.
`intensity` 0 with a tint set is a pocket that colors without brightening. Without `tint` a
pocket only brightens.

## The generic formations

Nine factories ship with the engine. Each takes `count`, a `seed` where there is anything to
randomize, and any personality fields (`opacity`, `size`, `chaos`, `cursorReach`, ...) passed
straight through; none sets its own opacity, size or chaos, so the engine defaults apply
unless you pass them.

| Factory | Shape |
| --- | --- |
| `curtainFormation` | A full frame scatter that tracks the viewport. `flow` drifts it, `"down"` like rain or `"right"` like dust on a breeze, wrapping so the curtain never empties. |
| `latticeFormation` | A flat regular grid facing the camera, laid out in a plane of its own. `width` and `height` are the plane where there is room for it and its proportions where there is not: a grid has edges, so the build fits the plane into the space the frame and the safe area leave, one factor on both axes so the cells stay square, and never scales it up past what it was given. Takes no seed: nothing to randomize. Rows are `ceil(count / cols)`, so a partial row stays inside the stated height. |
| `hourglassFormation` | The sand timer, read as a point field: two bells joined by a narrow waist, and the sand FALLS. The width a point may sit at is a function of how far up the timer it is (`waist` of the rim width at the middle, the full rim at either end, on a mild power curve so the bells read convex rather than as two cones), and the fall is a walk down that function, so the sand crowds into the throat and spreads again below. A grain that runs out of the bottom re-enters at the top, at the same fraction across its bell, so the timer never empties and the return lands on the field rather than tearing it. Laid out in its own plane like the lattice, and fitted into the space it has on the same rule, so `height` and `width` are the geometry wherever there is room for them. At the 3.6 by 5.2 it ships that is any frame with room, so the rule costs it nothing until a host crowds it. |
| `cloudFormation` | A volumetric scatter, uniform by volume inside a sphere and squashed in z, so it reads as a slab rather than a ball. `lobes` remaps it to the frame shape: a full frame atmosphere at a square or portrait frame, where the lobes would fall off the narrow frame, blending to two soft side lobes (one flanking each side of the copy) by 4:3, so a resize through the boundary stays continuous. z is untouched by the remap, so the toggle morphs in the xy plane only. |
| `horizonFormation` | A ground plane receding from the camera, and it sets `floor` by default, so cursor physics slide points along the ground. A partial far row stays inside the stated depth. |
| `streamFormation` | A full viewport horizontal river, and a FUNNEL: wide at both mouths, pinched to `waist` of that through the middle (0.34 by default, 1 the flat band it used to be), on a smoothstepped profile rather than a straight taper, so the current narrows into the center of the frame and opens again with no crease where the banks turn. Every point drifts at its own steady speed (0.18 to 0.48 world units a second) and wraps across the width, eased in by arrival so the river fades in with the morph. What is fixed per point is its fraction ACROSS the river, not its height: the flow re-reads the profile at the x a point has reached, so the funnel holds its shape while the water moves through it, and since the profile is symmetric a point leaving one mouth re-enters the other at the very same height. |
| `dnaFormation` | A centered double helix with real cylindrical depth: two opposite phase strands at equal x and z radii, twelve base pair rungs bridging them straight through the axis, and a live scroll along the axis. Every point belongs to a strand or a rung, so `diffusion` is the only thing that softens the edge and the stated reach is exact. It is intrinsic (the build ignores the viewport), sized to the shape convention (a reach of about 2.17) with a resting tilt baked in, so it reads correctly under the same `orient` math a geometry gets. The scroll is additive and arrival eased, so the morph in stays continuous and a background tab's clock reset can only shift the phase, never race the ladder. |
| `flowerFormation` | A wheel of seven teardrop petals on a shallow convex dome: z crests at the center toward the camera and falls away at the rim. Every point sits on a petal, so `diffusion` is the only thing that feathers the lobes and the stated reach is exact. Absent a `radius` the whole flower sizes from the frame's shorter side, so it holds its proportions from desktop to phone. The front faces +z, like every shape, so an `orient` pose reads the right way round instead of inverting. |
| `veinsFormation` | A branching network in three dimensions, read like a map of vessels: three trunks leave the center in a fan, each forks into two thinner branches and each of those into two thinner twigs, so twelve root-to-tip routes run over twenty-one vessels (three trunks, six branches, twelve twigs). A fork belongs to the NODE, not to the route, so the four routes leaving through one trunk walk the very same trunk and it carries four times the traffic of a twig, as a vessel does. Every point lies inside the tube around a vessel, whose thickness halves at every fork, so `diffusion` is the only thing that softens the edge. And it FLOWS: each point travels its route from trunk to tip and wraps back to the trunk, additive and arrival eased like the helix's scroll, bounded to one route per period so a background tab's clock reset cannot race it. The reach is measured off the grown tree (about 2.21 as it ships), and the tube's cross frame is carried through the forks rather than rebuilt, so nothing snaps sideways as it crosses one. |

**Every 3D formation takes `radius` and `diffusion`, the same two build inputs a sampled
geometry takes, with the same meaning and the same world units.** That is the rule, and it
holds one by one: `cloudFormation`, `horizonFormation`, `dnaFormation`, `flowerFormation` and
`veinsFormation` all answer both, exactly as `geometryFormation` and `composedFormation` do. `radius` is the
object's reach from its own center, in world units; `diffusion` is the 0..10 dial for how far
a point sits off the surface it belongs to, 0 crisp, 5 the tuned 0.02 world units, 10 the
softest 0.12. So you size and soften a helix exactly as you size and soften a torus knot, and
a host learns the pair once.

The four FLAT fields, `curtainFormation`, `latticeFormation`, `streamFormation` and
`hourglassFormation`, take neither, and that is not an oversight. They are scattered across the
LIVE viewport, which is what sizes them (a `radius` would fight the frame they track), or laid
out in a plane of their own, and a flat field has no surface for a point to sit off. They take
their own geometry instead: spans, columns, a plane's width and height, a timer's height, rim
width and waist.

Scattered and laid out are not the same thing, and the difference is which frame the build
reads. A SCATTER (the curtain, the stream, the lobed cloud) spans the whole canvas and is meant
to run off its edges, so it reads the frame and spans a little past it on purpose. A LAID OUT
field (the lattice, the hourglass) is a drawing with edges of its own, so it reads the frame
less the host's safe area and fits itself into that. Neither is a special case for one page;
they are the same question answered for two kinds of field.

Three notes on what `radius` means where the shape is not a ball. On `cloudFormation` it is the
sphere the points fill BEFORE the `lobes` remap, so with `lobes` on, the frame has the last
word on the final extent and the radius scales it from there. On `horizonFormation` it is the
far corner of the ground plane's footprint, 8.5 at the default 15 by 8, and the plane keeps
its ground height and its near edge as it grows, so a bigger horizon recedes further rather
than sliding toward the camera. On `veinsFormation` it is measured off the grown tree
rather than declared, the furthest any vessel reaches from the center (about 2.21 as it ships),
and asking for another one scales trunks, branches and vessel thickness together, so a big
network is the same network drawn large.

### What each one takes

Everything past `count` has a default that reproduces the look above, so a factory called with
nothing but a count is the shipped shape. World units throughout, except the fractions and the
dials, which say so.

| Factory | Its own options |
| --- | --- |
| `curtainFormation` | `flow` `"none" \| "down" \| "right"` (`"none"`), `speedMin` `0.18` and `speedMax` `0.48` world units a second, `spanX` `1.02` and `spanY` `1.08` as fractions of the viewport's world width and height, `depth` `1.4`, `seed` `1` |
| `latticeFormation` | `cols` `100` (rows follow from the count), `width` `11.2` and `height` `7.2` (the plane where there is room for it, its proportions where there is not), `z` `-1.8` |
| `hourglassFormation` | `height` `5.2`, `width` `3.6` at the rims, `waist` `0.1` as a fraction of that width, `speedMin` `0.2` and `speedMax` `0.5` in bell to bell travels a second, `depth` `0.3`, `seed` `1` |
| `cloudFormation` | `radius` `3.6`, `depthScale` `0.5` (the z squash), `z` `-1.2`, `lobes` `false`, `diffusion` `5`, `seed` `1` |
| `horizonFormation` | `cols` `120`, `width` `15`, `depth` `8`, `z` `-5.2` at the near edge, `y` `-1.65` for the ground height, `radius` (absent, which is the 8.5 the default footprint reaches), `diffusion` `5`, `seed` `1` |
| `streamFormation` | `waist` `0.34` as a fraction of the mouths' height, `seed` `1` |
| `dnaFormation` | `radius` (absent, about 2.17 as built), `diffusion` `5`, `seed` `1` |
| `flowerFormation` | `radius` (absent, sized from the shorter side of the space the safe area leaves), `diffusion` `5`, `seed` `1` |
| `veinsFormation` | `radius` (absent, about 2.21 as built), `diffusion` `5`, `seed` `1` |

Four of them own their motion and say so in their types: `hourglassFormation`,
`streamFormation`, `dnaFormation` and `veinsFormation` take every personality field except
`live`, because the fall, the current, the scroll and the flow ARE their `live` hook and a
second one would replace it. The other five accept yours. `curtainFormation` is the one that
does both: at `flow: "none"` a `live` you pass is the one that runs.

## Authoring a formation

A formation is a shape plus a personality. The only required field is `build`.

```ts
import { fieldHash01, type FieldFormation } from "@0backlog/nebula";

export function ringFormation(count: number, radius = 2): FieldFormation {
  return {
    opacity: 0.3, // a plain 0..1 material value
    size: 4, // the 0..10 dial: a touch finer than the nominal 5
    // a ring is intrinsic, so the build ignores the viewport it is handed
    build: (): Float32Array => {
      const a = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) {
        const u = fieldHash01(i * 13 + 5) * Math.PI * 2;
        a[i * 3] = Math.cos(u) * radius;
        a[i * 3 + 1] = Math.sin(u) * radius;
        a[i * 3 + 2] = (fieldHash01(i * 17 + 9) - 0.5) * 0.4;
      }
      return a;
    },
  };
}
```

### The fields

| Field | Type | What it does |
| --- | --- | --- |
| `build` | `(vp: FieldViewport) => Float32Array` | World space xyz triplets. `vp` carries css pixels (`w`, `h`), world units (`ww`, `wh`), and the safe area as a rectangle in those same world units: `sw`/`sh` for the size the host's cards leave and `sx`/`sy` for where its middle went (`ww`/`wh` and 0, 0 when no inset is declared). Scatter across the frame, lay out inside the safe size. `sx`/`sy` is for depth only: the engine has already moved the whole cloud there, so a build that lays out around its own origin must not add it a second time. |
| `opacity` | `number \| (vp) => number` | Resting material opacity, a plain 0..1 value and not a dial, default 0.3. A function lets a formation dim itself as the frame narrows. |
| `size` | `number \| (vp) => number` | Dot size dial, 0..10, default 5: 0.008 world units at 0, the tuned 0.032 at 5, 0.08 at 10. Eases on a morph, and the function form returns the dial value. |
| `chaos` | `number` 0..10 | Breathing dial, default 5: 0 holds the build perfectly still, 5 is the nominal breath, 10 the wildest tested. |
| `fit` | `boolean` | Scale down on narrow viewports. For drawings, not ambient fields. |
| `floor` | `{ y: number }` | The formation lies in the xz ground plane at this y, and cursor physics then act WITHIN that plane. `vortex` falls back to repel there. |
| `cursorReach` | `number` 0..10 | The cursor's effect radius, default 5: 0 no reach, 5 the tuned one, 10 the widest. Each mode's rim is a fixed multiple of it, and the force is exactly zero there, so widening the reach widens the whole soft falloff rather than moving an edge. |
| `cursorForce` | `number` 0..10 | How far the cursor pushes or pulls, default 5: 0 no push, 10 the hardest. |
| `sway` | `boolean` | A gentle y axis rock. |
| `live` | `(x, y, ctx) => readonly [number, number] \| readonly [number, number, number]` | Per point life after arrival. The pair moves the camera facing plane, the triple also moves depth. |
| `glow` | `(i, ctx) => number` | Per point brightness multiplier, 1 = base. Needs the per point material, so pass `glow` on DsField. |

### The rules

These are not style preferences. Break one and the field misbehaves in a way that is hard to
trace back.

- **Determinism.** Use `fieldHash01(i)` for every scatter. Never `Math.random`, never
  `Date.now`. A formation is rebuilt on every viewport change, and a shape that reshuffles
  itself turns a resize into a full remorph. Determinism holds within a session and across
  renders; `fieldHash01` is sine based, so bit identical results across JavaScript engines are
  not part of the promise.
- **Prefix stability.** Point `i` should depend on `i` and a seed, not on the count. Then
  raising a count knob leaves every existing dot where it was and only adds new ones. Hand the
  whole build over and let the engine choose: when it draws fewer points than the build holds
  (that is what `mobile` trims to) it strides through the build rather than cutting the tail,
  so a shape laid out in index order, a grid walked row by row, thins instead of cropping.
  The two GRIDS here are the deliberate exception: `latticeFormation` and `horizonFormation`
  fill a stated extent, so their row count follows from the point count and a count change
  re-lays the whole grid rather than adding to it. That is what a grid is. Every other
  formation in this file is prefix stable, and a new one should be.
- **Per point tables belong to the formation.** If `live` or `glow` indexes a table, allocate
  it at the formation's OWN count inside the factory. The engine calls your hooks with the
  BUILD index, never with the drawn slot (a trimmed field's dot 1 may be drawing build point
  4), so a table sized to the field's capacity wastes memory and a table sized shorter than
  the build reads garbage.
- **One reused output tuple.** `live` returns `readonly [number, number]`, or the triple form,
  and the engine reads it synchronously. Write into one module or closure level array rather
  than allocating; at 15000 points and 60 frames a second the allocation is the whole frame
  budget.
- **Move z when the motion has depth.** The pair form leaves depth exactly as `build` left it,
  which is what a flat drift like the curtain or the stream wants. A hook that walks a point
  along a shape with real depth must return the triple, adding onto `ctx.z`: otherwise the point
  keeps the depth of where it started while its x and y travel, and the shape shears apart under
  `orient` within seconds.
- **`ctx.e` is the per point morph progress**, 0 to 1. Scale anything dramatic by it so a
  formation morphing in does not snap into its extreme pose.

## three.js shapes

`field-shapes` turns any `BufferGeometry` into a formation by sampling points uniformly over
its surface: an area weighted triangle pick plus a uniform barycentric spread, seeded per
point, so the same geometry and count always scatter the same way.

```ts
import * as THREE from "three";
import { composedFormation, geometryFormation } from "@0backlog/nebula";

const knot = geometryFormation(new THREE.TorusKnotGeometry(1.35, 0.42, 220, 32), {
  count: 9000,
  radius: 2.4,
  opacity: 0.36,
});

// multi part shapes take a per part transform and a density weight
const flower = composedFormation(
  [
    { geometry: new THREE.SphereGeometry(0.5, 20, 14), at: [0, 1.6, 0], weight: 1.6 },
    { geometry: new THREE.CylinderGeometry(0.045, 0.06, 2.4, 10), at: [0, 0.1, 0], weight: 0.8 },
  ],
  { count: 9000, radius: 2.3, opacity: 0.36 },
);
```

Both factories take the same options, plus any formation personality:

| Option | Type | Default | What it does |
| --- | --- | --- | --- |
| `count` | `number` | required | Points sampled over the surface. Prefix stable, so raising it leaves every existing dot in place. |
| `radius` | `number` | `2.2` | The world radius the merged cloud is scaled to fit, the same convention every 3D formation takes. |
| `y` | `number` | `0.1` | Vertical center offset, world units. |
| `diffusion` | `number` 0..10 | `5` | Edge diffusion: how far sampled points scatter OFF the surface, which is what makes the silhouette read crisp or soft. 0 is a perfectly crisp surface (every point exactly on its triangle), 5 the tuned 0.02 world units, 10 the softest at 0.12, where a 2.2 radius shape is visibly furred but still itself. |
| `seed` | `number` | `1` | Shifts every hash stream, so two shapes of one geometry scatter differently. |

A part of a composition is a geometry plus where it sits and how densely it is sampled:

| Field | Type | Default | What it does |
| --- | --- | --- | --- |
| `geometry` | `BufferGeometry` | required | The surface this part samples. Cached per geometry, so repeating one geometry dozens of times costs one triangulation. |
| `at` | `[x, y, z]` | origin | Where the part sits in the merged shape, before that whole shape is recentered and scaled to `radius`. |
| `rot` | `[x, y, z]` | none | Radians, applied tilt (x) then azimuth (y), Euler order YXZ, which is the order `dnaFormation` bakes its own resting tilt in. |
| `scale` | `number \| [x, y, z]` | `1` | Uniform or per axis. It does not re weigh the part's share of the points, so scale a part up and give it a `weight` to match. |
| `weight` | `number` | `1` | Sampling density on top of the part's own area. |

`weight` matters more than it looks: sampling is area weighted, so a small dense part (an
emblem on a coin face, a bud on a stem) gets almost no points unless you ask for more. The
merged cloud recenters and scales to `radius` through a fixed 2048 point probe, so the
normalization can never depend on the live count.

**`diffusion` is a BUILD input, not a live one.** It is baked into the point positions, so
moving it means calling the factory again and handing `DsField` a new registry, which rebuilds.
That is cheap and safe: the engine takes a rebuild into the live cloud in place, no remount and
no reshuffle, because every point keeps its own surface anchor and only its offset from that
anchor scales. Where `chaos` moves a point every frame, `diffusion` moves it once. Register two
diffusions as two formations and switching between them is a real staggered morph, the same
trick two radii of one flower play.

`sampleGeometrySurface(geometry, count, seed)` is exported too, if you want the raw points
without a formation around them. It samples the surface exactly, with no diffusion of its own.

## The talking face

`faceFormation` samples a MediaPipe style landmark mesh, keeps each point's triangle and
barycentric coordinates, and re derives its position from the CURRENT landmarks every frame.
So the cloud is not a baked pose: move the jaw landmarks and the dots on the jaw follow. The
sampler weights each triangle by the feature weight of its landmarks, which is what puts the
points on the eyes, nose and lips instead of spending them on cheeks.

```tsx
import { DsField, faceFormation } from "@0backlog/nebula";

const formations = { face: faceFormation({ count: 12000, radius: 2.2, opacity: 0.36 }) };

<DsField formations={formations} formation="face" tint="#fafafa" glow />;
```

`glow` is worth passing: the face uses its `glow` hook to hold the flat plates back and light
the mouth as it opens, and without the per point material none of that renders.

| Option | Type | Default | What it does |
| --- | --- | --- | --- |
| `count` | `number` | required | Points sampled over the landmark mesh. Prefix stable, like the shapes. |
| `asset` | `FaceAsset` | the neutral face | 468 MediaPipe landmarks plus a triangulation. |
| `radius` | `number` | `2.2` | The world radius the head is scaled to. |
| `y` | `number` | `0.05` | Vertical center offset, world units. |
| `diffusion` | `number` 0..10 | `5` | Edge diffusion, the same dial the shapes carry, at the face's own scale: 0 a perfectly crisp surface, 5 the tuned 0.008 world units, 10 the softest at 0.05. It tops out far below the shapes' 0.12 because a face carries its silhouette in small features, the lid line and the lip line, so what still reads as dust on a torus knot closes the eyes of a head. Also a BUILD input: it rebuilds, and the talk is unaffected because the mouth is a per frame delta on top of whatever the build left. |
| `seed` | `number` | `1` | Shifts every hash stream. |

With nothing driving it the face breathes and blinks on a deterministic clock. There are two
ways to make it speak.

### From an audio element

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

The analyser splits the voiced range around the first and second formants, so the mouth is
SHAPED per vowel class rather than only opened: open vowels drop the jaw further, front vowels
(i, e) stretch the corners, rounded back vowels (o, u) purse them. Each band normalizes into
an adaptive window, because speech level swings far more than a mastered track's low end and
an absolute threshold reads as either always open or never open.

Note that once an element is routed through the analyser its sound reaches the speakers only
through the audio context, so `resumeFaceAudio` is not optional. A `MediaElementAudioSourceNode`
can be created only once per element, ever, so `attachFaceAudio` is idempotent per element and
safe across remounts.

### From a voice agent

`setFaceDrive` is the integration point. A TTS stream calls it as chunks arrive, at whatever
rate it has data, with an amplitude in 0..1.

```ts
import { clearFaceDrive, setFaceDrive } from "@0backlog/nebula";

for await (const chunk of ttsStream) {
  play(chunk);
  setFaceDrive({ open: amplitudeOf(chunk) });
}
clearFaceDrive(); // end of utterance: closes the mouth
```

`setFaceDrive` is partial, so pushing `{ open }` alone leaves `spread` and `round` following
whatever they were following. An external push outranks the analyser for 0.35 seconds and then
crossfades back, which means a dropped stream closes the mouth instead of freezing it open.

`setFaceGesture({ jaw, lips, blink })` shapes the delivery, all three 0..10 dials with 5 at the
tuned nominal. `jaw` and `lips` scale the mouth travel: 5 is 0.4 of the travel the asset
publishes (`MOUTH_TRAVEL` and friends are full range figures, a jaw at its widest drop, and a
sentence does not spend its time at the widest of anything), and 10 is DOUBLE the nominal, so
the whole dial is a range worth using rather than one whose useful part sat under 5. A host
that never calls this gets the nominal, which is the same face dial 5 asks for. `blink`
multiplies the blink rate, 0 stopping cleanly (a mid blink lid eases open) and 10 tripling it,
with the lid ramps keeping their tuned durations at any rate; it is a rate rather than a
travel, its own tuning, and the mouth retune left it alone.
`setFaceDriveGain(g)` dials the analyser path's sensitivity on the same 0..10 scale: it scales
the shaped mouth outputs, so it survives the adaptive window, and `setFaceDrive` pushes stay
absolute 0..1.

### A custom face

The neutral face is `src/field-face-neutral.json`, plain data you can open and diff your own
against (the build also copies it next to the bundle). Any pipeline that
produces 468 MediaPipe landmarks can feed the formation, and `parseFaceAsset` is the single
validation gate: it returns `null` rather than throwing, so a corrupt payload degrades to the
neutral face.

```ts
import { faceFormation, parseFaceAsset, type FaceAsset } from "@0backlog/nebula";

const stored = localStorage.getItem("my-app.face");
const asset: FaceAsset | null = stored ? parseFaceAsset(JSON.parse(stored)) : null;
const face = faceFormation({ count: 12000, asset: asset ?? undefined });
```

Face space is +x to the viewer's right, +y up, +z toward the viewer, centered on the landmark
bounding box and scaled so the furthest landmark sits at radius 1. Normalize your asset the
same way and the formation scales it by one world radius with no re tuning.

### Also exported

The face toolkit under the formation is public too: `buildDeformWeights`, `FACE_REGIONS`, the
travel constants (`MOUTH_TRAVEL`, `SPREAD_TRAVEL`, `ROUND_TRAVEL`), `toFaceGeometry`,
`DEFAULT_FACE`, `FACE_LANDMARK_COUNT`, the feature weight table (`FACE_FEATURE_WEIGHT`,
`FACE_FEATURE_PEAK`, `FACE_FEATURE_PLAIN`) and the `FaceAsset`, `FaceGeometry` and
`FaceDeform` types, so a landmark pipeline can build and validate assets without pulling in
the engine.

### One face at a time

The talk state, the landmark deltas and the audio context are module level singletons. Two
`DsField` instances showing a face on the same page share one mouth. That is deliberate (the
per frame path must not allocate or look anything up) but it is a real limit.

## The demo

It is live at **[0backlog.com/nebula](https://0backlog.com/nebula)**. From a clone:

```sh
pnpm install
pnpm demo      # builds the engine, then serves the demo on http://localhost:5173
```

Two floating cards over a full bleed canvas. The left one picks the formation, all of them,
grouped 2D, 3D and Face, the whole catalog in `examples/demo/src/shapes.ts` plus the generic
factories and the face, and it grows the face's own controls under the pill when the face is
up. The right one is every setting, grouped Formation, Dots, Cursor, Space, Orientation, Light,
Spotlights, Transitions and Pulsation. Every control is one DsField prop, one formation field,
one host hook's payload or one face dial, at its real range with no display scaling in between,
so the sliders read 0..10 exactly as the API does. A control that stops applying folds away
rather than sitting there dimmed, and a section whose controls have all gone takes its heading
with it, which is why the panel is shorter on a flat field than on a shape. Nothing explains
itself in prose: hover a control or a section heading for its card.

Pulsation carries the soundtrack, which is the reactive path end to end. Three patterns are
synthesized in the browser, five tracks ship with the demo, and you can drop in your own file.
All of them go through one Web Audio analyser (`beat.ts`, ported from the site the engine came
from), which hands the page a beat and a level; three send dials route that signal to the
pulse, to chaos and to the lights at once, and a send at 0 means that aspect ignores the
music. The bundled tracks are free with attribution, so selecting one shows its credit.

The face has a voice of its own, kept apart from the music: five short speech clips ship with
the demo, a simulation pushes amplitude through `setFaceDrive` with no sound at all (the voice
agent path, playable on a muted machine), and you can point it at your own file. The clips and
your file go through `attachFaceAudio` and never through the soundtrack's analyser, so the two
signals stay separate all the way down.

To publish a build of it: `pnpm --filter nebula-demo build`, then
`pnpm dlx wrangler@4 deploy --config examples/demo/wrangler.jsonc`. The build is based at
`/nebula/` and lands in `dist/nebula`, because the asset server matches URL paths to file
paths literally; `examples/demo/wrangler.jsonc` carries the route.

## Performance

- **Point count.** 9000 is a comfortable full screen default, 15000 is the tested ceiling. The
  per frame cost is the position buffer upload, which is linear in the DRAWN count, so a
  formation that builds fewer points than the capacity costs less, and `mobile` trims that
  count below 768 css px without touching the desktop look. The trim strides through the build,
  so the phone gets a sparser whole shape rather than the first slice of one.
- **Device pixel ratio.** DsField renders at dpr 1 on coarse pointers and up to 1.75 elsewhere.
  A phone GPU compositing 1.75x pixels on top of a per frame buffer upload is the case that
  drops frames.
- **Reduced motion.** Under `prefers-reduced-motion: reduce` the resting breath, the beat
  pulse and tremble, the drag's inertia and the trail are off, morphs snap, and the render loop
  drops to `demand`, so an idle field does no work at all. A drag still turns the cloud there:
  it asks for the frames it needs, since the motion is the user's own.
- **High refresh displays.** Every per frame ease (fit, sway, presence, gather, parallax) and
  the drag's coast are dt correct, so a 120Hz display matches the tuned 60fps feel instead of
  doubling it.
- **Hidden tab.** The loop stops on `visibilitychange` and resumes cleanly.
- **Build cost.** Formations build lazily, once per viewport, and only the ones actually
  visited pay. Viewport changes are debounced by 150 ms so a scrolling phone's URL bar does not
  thrash rebuilds. `radius` and `diffusion` are build inputs, so moving one resamples the
  formation and the engine takes the result into the live cloud in place, a snap rather than a
  staggered morph (register two variants as two formations and switch between them to make the
  change glide). Neither costs anything per frame.
- **The shader path** (`shine`, `round`, `additive` above 0, or `glow`, or `spotlights`) is a
  small custom material that is visually identical to the plain one when every amount is 0.
  Since `round` defaults to 10 it is the normal path, not the exception. Its mark carries about
  a pixel of analytic edge softness, so a still field at `shine` 0 is genuinely pixel static
  instead of twinkling as dots drift sub pixel. Leaving `glow` on site wide is fine.

## Browser support

WebGL is required. Where it is unavailable (blocked, headless, an ancient GPU) the canvas
renders `null` rather than throwing, so the surrounding page is unaffected. Plan for the field
simply not being there, and never put content inside it.

Web Audio is required for `attachFaceAudio` only. Without it playback still works and the face
stays idle, and `setFaceDrive` keeps working because it never touches the audio graph.

## Attribution

The committed neutral face (`src/field-face-neutral.json`) derives its landmarks and
triangulation from the MediaPipe canonical face model (`canonical_face_model.obj`), Copyright
2020 The MediaPipe Authors, licensed under the Apache License 2.0. See [NOTICE](./NOTICE) and
[LICENSE-APACHE-2.0](./LICENSE-APACHE-2.0): if you fork this or copy the face out of it, take
both with you, because that attribution is a condition of the licence and not a courtesy. It
is not a real person's likeness.

The engine itself ships no audio. The demo does: five music tracks that are free to use ON
THE CONDITION that the artist and the source are credited, which is what the credit deck in
`examples/demo/src/credits.tsx` is for, and five NASA speech clips that are public domain and
need nothing. If you fork the demo and remove the credit deck, remove the tracks with it.
[NOTICE](./NOTICE) names all ten.

## Contributing

Or not: forking and never coming back is a first class way to use this. If you do want to send
something, [CONTRIBUTING](./CONTRIBUTING.md) has the gate (`pnpm typecheck`, `pnpm lint`,
`pnpm build`) and the two rules that are not taste, both about determinism.

## License

MIT, Copyright (c) 2026 Zero Backlog LLC. See [LICENSE](./LICENSE).
