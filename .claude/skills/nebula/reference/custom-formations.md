# Write a formation

A formation is a shape plus a personality. `build` is the only necessary field. The words in
this file have the meanings that `SKILL.md` gives them.

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

## The fields of FieldFormation

| Field | Type | Default | What it does |
| --- | --- | --- | --- |
| `build` | `(vp: FieldViewport) => Float32Array` | required | World space xyz triplets, one per point. |
| `opacity` | `number \| ((vp: FieldViewport) => number)` | `0.3` | The resting material opacity. It is a plain 0..1 value, not a dial. The function form lets a formation dim itself as the frame narrows. |
| `size` | `number \| ((vp: FieldViewport) => number)` | `5` | The point size dial, 0..10: 0.008 world units at 0, the tuned 0.032 at 5, 0.08 at 10. It eases on a morph, and the function form returns the dial value. |
| `chaos` | `number` 0..10 | `5` | The breath dial. 0 holds the build perfectly still, 5 is the nominal breath, 10 is the largest tested breath. |
| `fit` | `boolean` | `false` | It scales the whole field down on a narrow viewport. Use it for a drawing, not for an ambient field. |
| `floor` | `{ y: number }` | none | The formation lies in the xz ground plane at this y. The cursor physics then act inside that plane, and `vortex` falls back to the repel push. |
| `cursorReach` | `number` 0..10 | `5` | The effect radius of the cursor: 0 world units at 0, the tuned 2.2 at 5, 3 at 10. The rim of each mode is a fixed multiple of it, and the force is exactly zero there. |
| `cursorForce` | `number` 0..10 | `5` | How far the cursor pushes or pulls: 0 at 0, the tuned 0.85 at 5, 3 at 10. |
| `sway` | `boolean` | `false` | A gentle rock around the y axis. It composes with an `orient` target and does not replace it. |
| `live` | `(x, y, ctx) => readonly [number, number] \| readonly [number, number, number]` | none | The life of a point after it arrives. The pair moves the point in the camera facing plane. The triple also moves the depth. |
| `glow` | `(i, ctx) => number` | none | A per point brightness multiplier, where 1 is the base. It needs the per point material, so set `glow` on `DsField`. |

## The two context types

```ts
interface FieldViewport {
  w: number;  // the canvas width, in CSS pixels
  h: number;  // the canvas height, in CSS pixels
  ww: number; // the world width that the same rectangle spans at z = 0
  wh: number; // the world height that the same rectangle spans at z = 0
  sw: number; // the width of the safe area, in world units
  sh: number; // the height of the safe area, in world units
  sx: number; // the middle of the safe area, from the middle of the canvas
  sy: number; // the same, on the vertical axis
}

interface FieldLiveCtx {
  i: number; // the BUILD index of this point
  z: number; // the depth that the point arrives at
  t: number; // the clock, in seconds
  e: number; // the morph progress of this point, 0 to 1
}
```

The four `s` fields are the safe area as a rectangle. It is the space that a person can see once
the floating cards of the host come off the canvas. The `inset` prop declares it. `sw` and `sh`
are its size, and `sx` and `sy` are its middle. All four are world units at the z = 0 plane. The
engine measures the middle from the middle of the canvas. A host that declares no `inset`
receives `ww`, `wh`, 0 and 0.

Read `vp.sw` and `vp.sh` in a formation that is laid out rather than scattered. Its edges then
land where a person can see them. No move of the center makes an object wider than the gap
between two cards fit between them. Read `vp.ww` and `vp.wh` in a field that is meant to bleed
off the canvas edges, and ignore the rest.

Warning: the engine has already moved the whole field to `sx`, `sy`. A build that adds the pair
again shifts the formation twice.

Do not add `vp.sx` and `vp.sy` in a build that lays out around its own origin. Use the pair only
for a formation that is laid out at a depth of its own. A world translation measured at z = 0
lands short on screen at another depth.

Warning: the engine reuses one `FieldLiveCtx` object for every point of every frame.

Read the fields inside the callback. Never keep the object.

## The rules

These are not style preferences. Each broken rule gives a defect that is hard to trace back to
its cause.

Warning: the engine rebuilds a formation on every viewport change. A shape that scatters itself
again turns a resize into a full morph.

1. Use `fieldHash01(i)` for every scatter. Never use `Math.random` and never use `Date.now`.

`fieldHash01` is deterministic inside a session and across renders. It is sine based, so
identical results across JavaScript engines are not part of the promise.

Warning: a build that reads the count breaks the prefix stability. A count knob then reshuffles
the whole field, and the points do not ease into place.

2. Make point `i` depend on `i` and on a seed, never on the count.

Give the whole build to the engine and let it choose. The engine sometimes shows fewer points
than the build carries, which is what `mobile` trims to. It then strides through the build and
does not cut the tail. A shape laid out in index order therefore thins and does not crop. The
two grids are the deliberate exception: `latticeFormation` and `horizonFormation` fill a stated
extent, so their row count follows from their point count.

Warning: the engine calls `live` and `glow` with the build index, never with the shown slot. A
table shorter than the build reads past its end and writes NaN into the position buffer. The NaN
never leaves the buffer. The engine reads the live positions back as the start of the next
morph.

3. Allocate every per point table inside the factory, at the count of the formation.

Warning: the allocation of one array per point is the whole frame budget at 15000 points and 60
frames a second.

4. Write into one array at module level or closure level, and return that same array from `live`.

The engine reads the returned tuple synchronously.

Warning: the pair form leaves the depth exactly where `build` left it. A point then keeps its
start depth while its x and y travel. The shape breaks apart within seconds under `orient`.

5. Return the triple form from `live` when the motion has depth, and add onto `ctx.z`.

The pair form is correct for a flat drift, such as the curtain or the stream.

6. Scale anything dramatic by `ctx.e`, the morph progress of the point. A formation that morphs
   in then eases into its extreme pose instead of a snap.

## What a good formation is

New formations are shapes, not layouts. Make no assumption about where a page puts its copy. Add
no branding. Hardcode no breakpoint. Turn every magic number into an option whose default
reproduces the shape that you contribute.
