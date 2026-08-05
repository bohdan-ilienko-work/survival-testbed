// Keyboard containment for an open dialog: who gets focus when it opens, who gets it back when
// it closes, and why Tab can never walk out of it.
//
// One module rather than three exports because the selector, the wrap-around and the restore are
// a single promise — "while this is open, the keyboard is in here" — and each of them is wrong on
// its own. Modal.tsx calls it once and hands the returned handler to the dialog element.

import { useEffect } from 'react';
import type { KeyboardEvent, RefObject } from 'react';

/**
 * Every element a keyboard can reach. Kept as one selector because the trap has to re-read
 * the dialog on EVERY Tab: a modal's contents change while it is open (a list loads, a
 * button un-disables after a grant), and a list captured once on open would send Tab to an
 * element that no longer exists.
 *
 * `:not([disabled])` matters more than it looks: a disabled control is skipped by the
 * browser too, so leaving it in would make `first`/`last` point at something Tab never
 * lands on, and the wrap-around would silently stop working.
 *
 * `:not([tabindex="-1"])` is on EVERY entry for the same reason, not just on the [tabindex]
 * one: a roving-tabindex widget — the character editor's tablist is one — parks -1 on its
 * inactive buttons, and those are still `button:not([disabled])`. Collect them and the ends
 * of the cycle can point at a node Tab never reaches.
 */
const FOCUSABLE = [
  'a[href]:not([tabindex="-1"])',
  'area[href]:not([tabindex="-1"])',
  'button:not([disabled]):not([tabindex="-1"])',
  'input:not([disabled]):not([tabindex="-1"])',
  'select:not([disabled]):not([tabindex="-1"])',
  'textarea:not([disabled]):not([tabindex="-1"])',
  'iframe:not([tabindex="-1"])',
  'summary:not([tabindex="-1"])',
  '[contenteditable="true"]:not([tabindex="-1"])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

const focusableIn = (root: HTMLElement): HTMLElement[] =>
  // getClientRects() and not offsetParent: a `position: fixed` child has no offsetParent yet
  // is perfectly visible, and skipping it would drop it out of the tab cycle. An element
  // hidden with display:none or inside a [hidden] subtree has no rects, which is the case
  // this filter is actually for — the browser will not focus it, so neither may we.
  Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => el.getClientRects().length > 0 && el.getAttribute('aria-hidden') !== 'true',
  );

/**
 * Holds the keyboard inside `dialogRef` for as long as `open`, and returns the keydown handler
 * that does the Tab wrap-around. The handler must be attached to the dialog element itself —
 * it reads `document.activeElement`, so it only makes sense while focus is already inside.
 */
export function useFocusTrap(
  open: boolean,
  dialogRef: RefObject<HTMLElement | null>,
): (e: KeyboardEvent<HTMLElement>) => void {
  useEffect(() => {
    if (!open) return;
    const restoreTo = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    // Content may nominate its own first stop; otherwise focus the window itself so screen
    // readers read the title, rather than jumping straight to the × and announcing "Закрити".
    const first = dialog?.querySelector<HTMLElement>('[data-autofocus]') ?? dialog;
    // preventScroll: the dialog is already centred in the viewport, and letting focus scroll
    // to it drags the frozen page behind the backdrop.
    first?.focus({ preventScroll: true });

    return () => {
      // Synchronous, never deferred to a frame: when one modal replaces another in the same
      // commit React runs this cleanup BEFORE the new dialog's setup, so the new one ends up
      // with focus. A restore parked in requestAnimationFrame would land after it and yank
      // focus back to the button that opened the modal that just closed.
      if (restoreTo?.isConnected) restoreTo.focus();
    };
  }, [open, dialogRef]);

  return (e) => {
    if (e.key !== 'Tab') return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const items = focusableIn(dialog);
    if (items.length === 0) {
      // Nothing to land on (a dialog that is only text): keep the caret on the window
      // instead of letting Tab hand focus to the page underneath.
      e.preventDefault();
      dialog.focus({ preventScroll: true });
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (e.shiftKey) {
      // `active === dialog` is the opening state — focus sits on the window, and
      // Shift+Tab from there must wrap to the END of the trap, not leave it.
      if (active === first || active === dialog) {
        e.preventDefault();
        last.focus();
      }
    } else if (active === last) {
      e.preventDefault();
      first.focus();
    }
  };
}
