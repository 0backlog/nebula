/* The pointer, tracked against the engine's own canvas. The one React hook in
 * the engine besides the components themselves: everything else the cursor
 * does (the physics, the drag, the trail) reads the two refs this hook keeps
 * fresh. */

import { useEffect, useRef } from "react";
import { useThree } from "@react-three/fiber";

/* shared cursor tracking: NDC against the CANVAS (not the window) so the cursor
 * lands true even when DsField renders inside a small panel.
 *
 * The canvas is also the GATE, not just the coordinate frame: the listeners sit
 * on gl.domElement, so the field is its own pointer zone. A pointer over a
 * control panel, a header or anything else stacked on top of the canvas never
 * reaches these handlers, the browser's own hit testing does the work, and the
 * pointer reads as absent for exactly as long as it is elsewhere. Everything
 * downstream (the cursor physics, the parallax lean, the trail) already eases
 * home on `on` going false, so leaving the canvas reads the same as leaving the
 * window always did. The cost of the gate: a host that sets pointer-events none
 * on the canvas gets no pointer at all, which is the honest reading of "the
 * field responds over its own canvas".
 *
 * The same listeners carry the DRAG the spin dial turns the cloud with: while
 * the primary button is down the hook accumulates the pointer's travel in NDC
 * units and the frame loop consumes it (it zeroes dx/dy as it takes them), so
 * the turn is measured in the frame it is applied and no event is dropped
 * between frames. `on` (the drag gate) is the spin dial being above 0: at 0 no
 * pointerdown handler runs and the canvas never captures a pointer, which is
 * what "dragging is off" has to mean for a host stacking its own drag on top. */
export function useFieldPointer(dragGate: boolean) {
  const { gl, invalidate } = useThree();
  const pointer = useRef({ x: 0, y: 0, on: false });
  const drag = useRef({ down: false, id: -1, lx: 0, ly: 0, dx: 0, dy: 0 });
  useEffect(() => {
    const el = gl.domElement;
    const d = drag.current;
    const onMove = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      const nx = ((e.clientX - r.left) / r.width) * 2 - 1;
      const ny = -((e.clientY - r.top) / r.height) * 2 + 1;
      // the drag accumulates wherever the pointer goes, the rect test below
      // included: a turn that started on the canvas keeps turning while the
      // hand runs past the edge (the capture below keeps the events coming),
      // so a throw is never cut short by the pointer leaving the zone.
      if (d.down && e.pointerId === d.id) {
        d.dx += nx - d.lx;
        d.dy += ny - d.ly;
        d.lx = nx;
        d.ly = ny;
        // under reduced motion the host runs the loop on DEMAND, so a drag has
        // to ask for the frame that will apply it: the hand turning the cloud
        // is the user's own motion, not motion the engine invented, and it is
        // the one thing that still moves there. Under the live loop this is a
        // counter bump and nothing else.
        invalidate();
      }
      // the rect test is load bearing even with canvas-scoped listeners: a drag
      // that started on the canvas keeps delivering moves through pointer
      // capture after it leaves, and no pointerleave follows it out. No margin
      // any more: the zone is the canvas, edge included, and nothing past it.
      if (nx < -1 || nx > 1 || ny < -1 || ny > 1) {
        pointer.current.on = false;
        return;
      }
      pointer.current.x = nx;
      pointer.current.y = ny;
      pointer.current.on = true;
    };
    const onDown = (e: PointerEvent) => {
      // primary button only: a right click or a second finger is not a turn
      if (!e.isPrimary || e.button !== 0) return;
      const r = el.getBoundingClientRect();
      d.down = true;
      d.id = e.pointerId;
      d.lx = ((e.clientX - r.left) / r.width) * 2 - 1;
      d.ly = -((e.clientY - r.top) / r.height) * 2 + 1;
      d.dx = 0;
      d.dy = 0;
      // capture retargets every later move AND the release to the canvas, so a
      // hand that lets go outside the frame still ends the drag here instead of
      // leaving it stuck down
      el.setPointerCapture(e.pointerId);
    };
    const onRelease = (e: PointerEvent) => {
      if (e.pointerId !== d.id) return;
      d.down = false;
      d.id = -1;
    };
    const onLeave = () => {
      pointer.current.on = false;
    };
    const onCancel = (e: PointerEvent) => {
      onRelease(e);
      onLeave();
    };
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerleave", onLeave);
    // a cancelled pointer (a touch turning into a scroll, the tab going away
    // mid-drag) never sends a leave of its own
    el.addEventListener("pointercancel", onCancel);
    if (dragGate) {
      el.addEventListener("pointerdown", onDown);
      el.addEventListener("pointerup", onRelease);
      // capture can be taken away (another element grabbing it, the element
      // going away): the drag ends there too, keeping whatever throw it had
      el.addEventListener("lostpointercapture", onRelease);
    }
    return () => {
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerleave", onLeave);
      el.removeEventListener("pointercancel", onCancel);
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointerup", onRelease);
      el.removeEventListener("lostpointercapture", onRelease);
      // the dial going to 0 mid-drag must not park the cloud mid-turn
      d.down = false;
      d.id = -1;
      d.dx = 0;
      d.dy = 0;
    };
  }, [gl, dragGate, invalidate]);
  return { pointer, drag };
}
