import { useEffect, useId, useRef } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import './ui.css';

export interface ModalProps {
  open: boolean;
  title: ReactNode;
  subtitle?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  /** right-aligned action row pinned under the scrollable body */
  footer?: ReactNode;
  /** width preset; default 'md' */
  size?: 'sm' | 'md' | 'lg';
  /** disables backdrop/Escape closing while an action is in flight */
  busy?: boolean;
}

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
 * Deliberately NOT exported. It is reusable in principle, but this file's public surface is a
 * component, and Vite's Fast Refresh only keeps state for a module that exports components and
 * nothing else (oxlint's react/only-export-components enforces exactly that). Anything that
 * genuinely needs the lock on its own should move it into its own module rather than make
 * every edit to this one blow away the open dialog's state.
 */
function useLockBodyScroll(locked: boolean): void {
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

/**
 * The open dialogs, oldest first. Escape must close ONE modal — the top one — and without
 * this every mounted dialog would hear the same keydown and close together.
 */
const openStack: object[] = [];

/**
 * A real modal window: portalled, escapable, focus-trapped, scroll-locking.
 *
 * Rendered through a portal into <body> rather than in place, because in this app a dialog
 * can be opened from inside a panel that clips (`.roster` and `.events` are `overflow: auto`)
 * and from beside a Leaflet map that stacks its own controls at z-index 1000. Either one
 * would cut the dialog in half or paint over it if it stayed in the tree where it was
 * declared.
 *
 * Returns null while closed, so a parent can mount it unconditionally and just flip `open` —
 * the callers here keep their draft state in the parent anyway.
 */
export function Modal({
  open,
  title,
  subtitle,
  onClose,
  children,
  footer,
  size = 'md',
  busy = false,
}: ModalProps): ReactElement | null {
  const dialogRef = useRef<HTMLDivElement>(null);
  const id = useId();
  const titleId = `${id}-title`;
  const subtitleId = `${id}-sub`;

  // The Escape listener is subscribed once per OPEN, not once per render. Reading `onClose`
  // and `busy` through refs is what makes that possible: a parent that passes an inline
  // arrow (all of them do) produces a new onClose every render, and a listener keyed on it
  // would re-register constantly — which, worse than being wasteful, would re-push this
  // dialog onto openStack and hand "topmost" to whichever modal re-rendered last.
  const onCloseRef = useRef(onClose);
  const busyRef = useRef(busy);
  useEffect(() => {
    onCloseRef.current = onClose;
    busyRef.current = busy;
  });

  useLockBodyScroll(open);

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
  }, [open]);

  // Which element the press STARTED on. A click's target is the common ancestor of press and
  // release, so a text selection begun inside the dialog and dragged out onto the backdrop
  // reports the backdrop as its target — and a naive `e.target === backdrop` check would read
  // that as "clicked outside" and throw the user's work away.
  const pressedOn = useRef<EventTarget | null>(null);

  // Truthiness, not `!== undefined`: a caller that builds these conditionally lands on `null`
  // or `false` far more often than on `undefined` (`{cond && <p/>}`, `{cond ? x : null}`), and
  // each of those has to mean "there isn't one". Rendered anyway they would be an empty
  // subtitle wired to aria-describedby — a screen reader announcing a blank description — and
  // an empty footer bar sitting under the body as a stray strip of border.
  const hasSubtitle = Boolean(subtitle);
  const hasFooter = Boolean(footer);

  if (!open) return null;

  return createPortal(
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        pressedOn.current = e.target;
        // Keep focus where the trap put it: pressing the bare backdrop would otherwise blur
        // into <body>, and the next Tab would walk out of the dialog into the page behind.
        if (e.target === e.currentTarget) e.preventDefault();
      }}
      onMouseUp={(e) => {
        const startedOnBackdrop = pressedOn.current === e.currentTarget;
        pressedOn.current = null;
        // Both ends of the click must land on the backdrop itself, and only the primary
        // button counts — a right-click that opens the context menu is not a dismissal.
        if (e.button !== 0 || busy) return;
        if (startedOnBackdrop && e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className={`modal ${size}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={hasSubtitle ? subtitleId : undefined}
        tabIndex={-1}
        onKeyDown={(e) => {
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
        }}
      >
        <div className="modal-head">
          <div className="txt">
            <h2 className="modal-title" id={titleId}>
              {title}
            </h2>
            {hasSubtitle && (
              <p className="modal-sub" id={subtitleId}>
                {subtitle}
              </p>
            )}
          </div>
          {/* Disabled together with the backdrop and Escape: `busy` exists to keep a request
              in flight from being abandoned halfway, and a live × would be a hole straight
              through that guarantee. */}
          <button
            type="button"
            className="modal-close"
            onClick={onClose}
            disabled={busy}
            aria-label="Закрити"
            title={busy ? 'зачекай, запит ще виконується' : 'Закрити (Esc)'}
          >
            ✕
          </button>
        </div>

        <div className="modal-body">{children}</div>

        {hasFooter && <div className="modal-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
