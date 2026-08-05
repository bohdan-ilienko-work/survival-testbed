// The CHRONO pairing rules, and the HTML5 drag layer that drives them.
//
// Every gesture — drop, click, Enter on a focused chip — goes through the SAME assign(). The
// swap rule it implements is a server invariant (fight-server facts.ts, isValidFactsAnswer), so
// a second implementation of it is a second thing that can drift out of agreement with the
// validator. That is the whole reason this sits apart from the markup that renders it.

import { useRef, useState } from 'react';
import type { DragEvent } from 'react';

export interface ChronoPairingOptions {
  events: { id: number; text: string }[];
  years: number[];
  pairs: number[];
  disabled: boolean;
  onPairs: (pairs: number[]) => void;
}

export function useChronoPairing({ events, years, pairs, disabled, onPairs }: ChronoPairingOptions) {
  // The draft starts as [] (that is also what a new round resets it to), so a missing slot reads
  // as "not paired yet" instead of undefined leaking into the answer.
  const yearOf = (i: number) => pairs[i] ?? -1;
  /** which event currently holds year `yi`, -1 = nobody */
  const holderOf = (yi: number) => events.findIndex((_, i) => yearOf(i) === yi);

  const assign = (i: number, yi: number) => {
    // Rebuilt at full length every time: the answer must be exactly as long as the event list,
    // whatever the draft happened to be sparse at.
    const next = events.map((_, k) => yearOf(k));
    const held = next[i];
    if (held === yi) {
      next[i] = -1;
      onPairs(next);
      return;
    }
    const other = next.findIndex((v, k) => k !== i && v === yi);
    if (other >= 0) next[other] = held;
    next[i] = yi;
    onPairs(next);
  };

  /**
   * Dropped back into the pool. Routed through assign()'s own toggle rather than writing -1
   * here: that keeps the "one year, one event" bookkeeping in a single function.
   */
  const unpair = (yi: number) => {
    const holder = holderOf(yi);
    if (holder >= 0) assign(holder, yi);
  };

  /** the chip in flight; `key` says WHICH copy of that year it is, so only that one dims */
  const [drag, setDrag] = useState<{ yi: number; key: string } | null>(null);
  /** the drop target under the pointer — an event index, or the un-pair pool */
  const [over, setOver] = useState<number | 'pool' | null>(null);
  /**
   * The same year index, in a ref, because the FIRST dragover can reach a target before React
   * has re-rendered with the state — and a dragover that skips preventDefault is a target that
   * silently refuses the drop.
   */
  const dragged = useRef<number | null>(null);

  const endDrag = () => {
    dragged.current = null;
    setDrag(null);
    setOver(null);
  };

  const dragProps = (yi: number, key: string) => ({
    draggable: !disabled,
    onDragStart: (e: DragEvent) => {
      e.dataTransfer.effectAllowed = 'move';
      // Firefox starts no drag at all unless something is written here, so this is required
      // even though the ref below is what the drop actually reads first.
      e.dataTransfer.setData('text/plain', String(yi));
      dragged.current = yi;
      setDrag({ yi, key });
    },
    // Fires after EVERY drag, including one released over nothing — which is exactly why the
    // pairing is only ever written in onDrop: a drop outside a target must change nothing.
    onDragEnd: endDrag,
  });

  /** The year a drop is carrying, re-checked against the CURRENT strip before it is used. */
  const droppedYear = (e: DragEvent): number | null => {
    const raw = e.dataTransfer.getData('text/plain');
    const yi = raw === '' ? dragged.current ?? -1 : Number(raw);
    // an index from a strip that no longer exists (the round changed mid-drag) would be exactly
    // the out-of-range value isValidFactsAnswer rejects
    return Number.isInteger(yi) && yi >= 0 && yi < years.length ? yi : null;
  };

  const dropProps = (target: number | 'pool') => ({
    onDragOver: (e: DragEvent) => {
      // preventDefault is what MAKES a drop legal, so it is spent only on our own chips: a file
      // or a text selection dragged in from outside must go on being refused by the browser.
      if (disabled || dragged.current === null) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (over !== target) setOver(target);
    },
    onDragLeave: (e: DragEvent) => {
      // dragleave also fires when the pointer crosses from the row onto a chip INSIDE it, so the
      // highlight is dropped only when the pointer really left the target — otherwise it blinks
      // off and on again over every chip.
      if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
      setOver((t) => (t === target ? null : t));
    },
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      const yi = droppedYear(e);
      if (yi !== null) {
        if (target === 'pool') unpair(yi);
        // Dropping a year back on the row that already holds it is a no-op, not an un-pair.
        // assign() treats a repeat as the toggle — right for a CLICK, wrong for a drag, where
        // "put it back where I picked it up" must mean "cancel", never "remove it". The pool
        // is the un-pair target, and dragging out to it still works.
        else if (holderOf(yi) !== target) assign(target, yi);
      }
      endDrag();
    },
  });

  const paired = events.reduce((n, _, i) => (yearOf(i) === -1 ? n : n + 1), 0);
  /** years nobody holds — the pool's contents, and the only list that shrinks as pairs are made */
  const free = years.map((_, yi) => yi).filter((yi) => holderOf(yi) === -1);

  return { yearOf, holderOf, assign, drag, over, dragProps, dropProps, paired, free };
}
