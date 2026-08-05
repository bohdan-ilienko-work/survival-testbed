// The refcounted scroll lock that holds the page still behind an overlay.
//
// It is one of the three mechanisms Modal is built from, and the only one with state that
// outlives a component: two overlays can be up at once, so the bookkeeping has to be shared by
// every caller rather than kept per dialog. That shared state is what makes it a module.

import { useEffect } from 'react';

/**
 * How many overlays currently hold the page still, and what the page looked like before the
 * FIRST of them took over. Both have to be module-level: two modals can be open at once (a
 * confirmation over an editor), and per-component state would let the inner one's cleanup
 * hand the page back while the outer one is still up.
 */
let lockCount = 0;
let lockedStyle: { overflow: string; paddingRight: string } | null = null;

/**
 * Freezes the page behind an overlay, and gives back EXACTLY what it took.
 *
 * The restore writes the previous INLINE values back, never a hardcoded '': if anything else
 * ever sets body overflow (a drawer, a screenshot mode), resetting to '' would silently
 * revert it and unlock a page that was meant to stay locked.
 *
 * Nesting is refcounted for the mirror-image reason — the classic bug is opening B from A,
 * closing B, and finding the page scrollable underneath A while A is still covering it.
 *
 * Lives here rather than inside Modal.tsx: that file's public surface is a component, and
 * Vite's Fast Refresh only keeps state for a module that exports components and nothing else
 * (oxlint's react/only-export-components enforces exactly that). Exporting the lock from there
 * would make every edit to the dialog blow away the open dialog's state.
 */
export function useLockBodyScroll(locked: boolean): void {
  useEffect(() => {
    if (!locked) return;
    lockCount += 1;
    if (lockCount === 1) {
      const { body } = document;
      lockedStyle = { overflow: body.style.overflow, paddingRight: body.style.paddingRight };
      // Hiding the overflow also removes the scrollbar, and on a desktop with classic
      // scrollbars the page underneath jumps sideways by its width the instant a modal
      // opens. Pay that width back as padding so nothing behind the backdrop moves.
      const gutter = window.innerWidth - document.documentElement.clientWidth;
      if (gutter > 0) {
        body.style.paddingRight = `${(Number.parseFloat(lockedStyle.paddingRight) || 0) + gutter}px`;
      }
      body.style.overflow = 'hidden';
    }
    return () => {
      lockCount -= 1;
      if (lockCount === 0 && lockedStyle) {
        document.body.style.overflow = lockedStyle.overflow;
        document.body.style.paddingRight = lockedStyle.paddingRight;
        lockedStyle = null;
      }
    };
  }, [locked]);
}
