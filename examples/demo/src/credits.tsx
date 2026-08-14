/* The soundtrack credit deck.
 *
 * The bundled tracks are free to use on the condition that the artist and the
 * source are credited with a working link, so this is a licence requirement
 * wearing a nice coat, not decoration. Mount it once and feed it the id of the
 * source that is currently selected:
 *
 *   <Credits sourceId={track} />
 *
 * Every change to a source that carries a credit pushes a toast to the front
 * of a stack at the top of the page. Consecutive picks recede behind the
 * newest one; hovering the deck fans it out into a readable list and pauses
 * every timer, so the links stay reachable, and a short tail dismisses them
 * once the pointer leaves. Sources with no credit (the synthesized patterns,
 * an uploaded file) push nothing, and the first value is not announced: a
 * restored selection is not news.
 *
 * Ported from the 0switch lab's toast deck, minus the animation library. The
 * stack is inline transforms over a CSS transition, which is all a fade and a
 * fan need. */

import { useCallback, useEffect, useRef, useState } from "react";
import { sourceById, type SoundtrackSource, type SourceId } from "./soundtrack";
import "./credits.css";

const DECK_MAX = 4; // items kept in the deck, older ones drop off the back
const DECK_VISIBLE = 3; // items that peek out of the collapsed deck
const ROW_PX = 34; // per item step when the deck is fanned open
const PEEK_PX = 7; // per item step when the deck is collapsed
const LIFE_MS = 6000; // time to live for a fresh toast
const TAIL_MS = 1600; // time to live after the pointer leaves the open deck
const EXIT_MS = 320; // must outlast the fade in credits.css
const LEAVE_GRACE_MS = 80; // crossing the gaps between fanned toasts is not a leave

type Phase = "in" | "on" | "out";
type Item = { id: number; source: SoundtrackSource; phase: Phase };

export function Credits({ sourceId }: { sourceId: SourceId | string | null | undefined }) {
  const [items, setItems] = useState<Item[]>([]);
  const [expanded, setExpanded] = useState(false);

  // the last id that was announced, seeded with whatever was selected at mount:
  // a restored selection is not news, and comparing values rather than counting
  // renders keeps this correct under StrictMode's double invoke.
  const announced = useRef(sourceId);
  const nextId = useRef(0);
  const itemsRef = useRef<Item[]>([]);
  const expandedRef = useRef(false);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  const collapse = useRef<ReturnType<typeof setTimeout> | null>(null);
  /* the entrance frames and their fallback timer, PER TOAST. One shared pair
   * let a second credit pushed within a frame or two cancel the first one's
   * raise, leaving it at opacity 0 for its whole life while it still held a
   * deck slot. Keyed on the toast, that cannot happen however close together
   * two picks land, and a toast that never arrives is a credit that never
   * showed. */
  const raising = useRef(new Map<number, { frame: number; timer: ReturnType<typeof setTimeout> }>());

  // mirrored into refs so the handlers below read the current deck without
  // being rebuilt on every change. Declared first: the push effect reads them.
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);
  useEffect(() => {
    expandedRef.current = expanded;
  }, [expanded]);

  const clear = useCallback((id: number) => {
    const tm = timers.current.get(id);
    if (tm) clearTimeout(tm);
    timers.current.delete(id);
  }, []);

  const stopRaise = useCallback((id: number) => {
    const r = raising.current.get(id);
    if (!r) return;
    cancelAnimationFrame(r.frame);
    clearTimeout(r.timer);
    raising.current.delete(id);
  }, []);

  // two steps out: fade in place, then unmount once the transition has run
  const drop = useCallback(
    (id: number) => {
      clear(id);
      stopRaise(id);
      setItems((prev) => prev.map((i) => (i.id === id ? { ...i, phase: "out" } : i)));
      timers.current.set(
        id,
        setTimeout(() => {
          clear(id);
          setItems((prev) => prev.filter((i) => i.id !== id));
        }, EXIT_MS),
      );
    },
    [clear, stopRaise],
  );

  const arm = useCallback(
    (id: number, ms: number) => {
      clear(id);
      timers.current.set(id, setTimeout(() => drop(id), ms));
    },
    [clear, drop],
  );

  // a new pick pushes a toast to the front. No autodismiss while the deck is
  // open: it gets a tail when the pointer leaves instead.
  useEffect(() => {
    if (announced.current === sourceId) return;
    announced.current = sourceId;
    const source = sourceById(sourceId);
    if (!source?.credit) return;
    const id = ++nextId.current;
    const fresh: Item = { id, source, phase: "in" };
    setItems((prev) => [fresh, ...prev].slice(0, DECK_MAX));
    // Paint the entry state before flipping to the resting one, otherwise the
    // browser coalesces both into no transition at all. Two frames is the
    // reliable straddle, and the timer is the fallback: a hidden tab runs no
    // frames, and a toast that never arrives is a credit that never showed.
    // Both are keyed on THIS toast, so a second credit cannot cancel them.
    const raise = () => {
      stopRaise(id);
      setItems((prev) => prev.map((i) => (i.id === id && i.phase === "in" ? { ...i, phase: "on" } : i)));
    };
    const entry: { frame: number; timer: ReturnType<typeof setTimeout> } = {
      frame: 0,
      timer: setTimeout(raise, 80),
    };
    entry.frame = requestAnimationFrame(() => {
      entry.frame = requestAnimationFrame(raise);
    });
    raising.current.set(id, entry);
    if (!expandedRef.current) arm(id, LIFE_MS);
  }, [sourceId, arm, stopRaise]);

  const onEnter = () => {
    if (collapse.current) {
      clearTimeout(collapse.current);
      collapse.current = null;
    }
    // pause everything that is still on screen, including any exit already
    // underway: reaching for a link should never be a race
    itemsRef.current.forEach((i) => clear(i.id));
    setItems((prev) => prev.map((i) => (i.phase === "out" ? { ...i, phase: "on" } : i)));
    setExpanded(true);
  };

  const onLeave = () => {
    if (collapse.current) clearTimeout(collapse.current);
    collapse.current = setTimeout(() => {
      collapse.current = null;
      setExpanded(false);
      itemsRef.current.forEach((i) => arm(i.id, TAIL_MS));
    }, LEAVE_GRACE_MS);
  };

  useEffect(() => {
    const running = timers.current;
    const entering = raising.current;
    return () => {
      running.forEach((tm) => clearTimeout(tm));
      running.clear();
      entering.forEach((r) => {
        cancelAnimationFrame(r.frame);
        clearTimeout(r.timer);
      });
      entering.clear();
      if (collapse.current) clearTimeout(collapse.current);
    };
  }, []);

  if (items.length === 0) return null;

  return (
    <div className="sndDeck">
      {/* focus fans the deck the way the pointer does: the credits are links,
          and a keyboard reaching one has to be able to see the toast it is in.
          React's onFocus/onBlur are focusin/focusout, so a link inside opens
          it, and the leave grace covers the step between two of them. */}
      <div
        className="sndAnchor"
        onMouseEnter={onEnter}
        onMouseLeave={onLeave}
        onFocus={onEnter}
        onBlur={onLeave}
      >
        {items.map((it, i) => {
          const c = it.source.credit;
          if (!c) return null;
          const depth = Math.min(i, DECK_VISIBLE);
          // the fourth stays hidden until the deck is fanned open
          const buried = i >= DECK_VISIBLE && !expanded;
          const gone = it.phase !== "on";
          const y = expanded ? i * ROW_PX : depth * PEEK_PX;
          const scale = expanded ? 1 : 1 - depth * 0.05;
          return (
            <div
              key={it.id}
              className="sndToast"
              style={{
                transform: `translate(-50%, ${gone ? y - 8 : y}px) scale(${gone ? scale * 0.96 : scale})`,
                opacity: gone || buried ? 0 : expanded ? 1 : 1 - depth * 0.12,
                // a toast nobody can see must not be a tab stop with a live
                // link in it. visibility is on the transition, so hiding waits
                // for the fade while showing lands at once.
                visibility: gone || buried ? "hidden" : "visible",
                zIndex: 100 - i,
              }}
            >
              {/* one text flow rather than flex children, so the space before
                  the link survives and the credit reads as a sentence */}
              <span>
                <span className="sndTitle">{it.source.label}</span> by {c.by}, via{" "}
                <a className="sndVia" href={c.url} target="_blank" rel="noopener noreferrer">
                  {c.via}
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path
                      d="M7 17 17 7M9 7h8v8"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </a>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
