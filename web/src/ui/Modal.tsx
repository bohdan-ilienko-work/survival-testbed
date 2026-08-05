import { useId, useRef } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useLockBodyScroll } from './bodyScrollLock';
import { useFocusTrap } from './focusTrap';
import { useBackdropDismiss, useEscapeToClose } from './modalDismiss';
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
 *
 * The three mechanisms that make it behave like a window rather than a floating <div> are one
 * module each — ./bodyScrollLock, ./modalDismiss and ./focusTrap. What is left in this file is
 * the markup and the wiring, which is the part a reader changing the dialog's LOOK cares about.
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

  useLockBodyScroll(open);
  useEscapeToClose(open, onClose, busy);
  const onTabKeyDown = useFocusTrap(open, dialogRef);
  const backdrop = useBackdropDismiss(onClose, busy);

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
      onMouseDown={backdrop.onMouseDown}
      onMouseUp={backdrop.onMouseUp}
    >
      <div
        ref={dialogRef}
        className={`modal ${size}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={hasSubtitle ? subtitleId : undefined}
        tabIndex={-1}
        onKeyDown={onTabKeyDown}
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
