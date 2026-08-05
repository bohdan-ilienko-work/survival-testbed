// The two ways a dialog can be dismissed without aiming at a button: Escape, and a click on the
// backdrop around it.
//
// Both are "the user meant to leave", both must be refused while a request is in flight, and both
// are far trickier than they look — which is why they live beside each other here instead of as
// two inline handlers in Modal.tsx.

import { useEffect, useRef } from 'react';
import type { MouseEvent } from 'react';

/**
 * The open dialogs, oldest first. Escape must close ONE modal — the top one — and without
 * this every mounted dialog would hear the same keydown and close together.
 */
const openStack: object[] = [];

/**
 * Closes this dialog on Escape, but only while it is the topmost one and not busy.
 *
 * The Escape listener is subscribed once per OPEN, not once per render. Reading `onClose`
 * and `busy` through refs is what makes that possible: a parent that passes an inline
 * arrow (all of them do) produces a new onClose every render, and a listener keyed on it
 * would re-register constantly — which, worse than being wasteful, would re-push this
 * dialog onto openStack and hand "topmost" to whichever modal re-rendered last.
 */
export function useEscapeToClose(open: boolean, onClose: () => void, busy: boolean): void {
  const onCloseRef = useRef(onClose);
  const busyRef = useRef(busy);
  useEffect(() => {
    onCloseRef.current = onClose;
    busyRef.current = busy;
  });

  useEffect(() => {
    if (!open) return;
    const token = {};
    openStack.push(token);

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      // Bubble phase, and defaultPrevented is honoured, so a widget inside the body (an
      // autocomplete, a native picker) gets to eat its own Escape before we close the whole
      // window out from under it.
      if (openStack[openStack.length - 1] !== token) return;
      if (busyRef.current) return;
      onCloseRef.current();
    };
    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      const at = openStack.indexOf(token);
      if (at >= 0) openStack.splice(at, 1);
    };
  }, [open]);
}

/** Mouse handlers for the backdrop element — press and release, never `onClick`. See below. */
export interface BackdropHandlers {
  onMouseDown: (e: MouseEvent<HTMLElement>) => void;
  onMouseUp: (e: MouseEvent<HTMLElement>) => void;
}

/**
 * Closes the dialog when the backdrop — and only the backdrop — is clicked.
 *
 * Split across mousedown/mouseup rather than written as an onClick because a click's target is
 * the common ancestor of press and release: see the note on `pressedOn` below.
 */
export function useBackdropDismiss(onClose: () => void, busy: boolean): BackdropHandlers {
  // Which element the press STARTED on. A click's target is the common ancestor of press and
  // release, so a text selection begun inside the dialog and dragged out onto the backdrop
  // reports the backdrop as its target — and a naive `e.target === backdrop` check would read
  // that as "clicked outside" and throw the user's work away.
  const pressedOn = useRef<EventTarget | null>(null);

  return {
    onMouseDown: (e) => {
      pressedOn.current = e.target;
      // Keep focus where the trap put it: pressing the bare backdrop would otherwise blur
      // into <body>, and the next Tab would walk out of the dialog into the page behind.
      if (e.target === e.currentTarget) e.preventDefault();
    },
    onMouseUp: (e) => {
      const startedOnBackdrop = pressedOn.current === e.currentTarget;
      pressedOn.current = null;
      // Both ends of the click must land on the backdrop itself, and only the primary
      // button counts — a right-click that opens the context menu is not a dismissal.
      if (e.button !== 0 || busy) return;
      if (startedOnBackdrop && e.target === e.currentTarget) onClose();
    },
  };
}
