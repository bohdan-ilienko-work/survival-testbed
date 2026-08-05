// Which modal is up.
//
// Nothing else: what each dialog SHOWS belongs to the hook that fetched it, and what each one
// asks on the way up is wired in App, next to the actions it calls.

import { useRef, useState } from 'react';
import type { RefObject } from 'react';
import type { Dialog } from './types';

export interface Dialogs {
  dialog: Dialog | null;
  /**
   * The same value in a ref, for code that runs outside a render. Read by quoteBuyBack, which
   * is also fired by an effect during a match: a price it failed to fetch on its own must not
   * be reported inside whatever OTHER dialog happens to be open.
   */
  dialogRef: RefObject<Dialog | null>;
  /** @param ask the question this dialog exists to answer, fired on the way up */
  open: (which: Dialog, ask?: () => Promise<unknown>) => void;
  close: () => void;
}

/**
 * @param clearDialogError run() writes a modal button's refusal into a box that belongs to the
 * dialog, not to the app — so opening the next one has to wipe it.
 */
export function useDialogs(clearDialogError: () => void): Dialogs {
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const dialogRef = useRef<Dialog | null>(null);

  dialogRef.current = dialog;

  // A dialog always opens on a clean slate: the previous dialog's refusal is not this one's.
  // Each of them also asks its own question on the way up, so opening one is one click rather
  // than "open, then press refresh".
  const open = (which: Dialog, ask?: () => Promise<unknown>) => {
    clearDialogError();
    setDialog(which);
    // Whatever the refusal was, it is already on screen — in this dialog's own error box or in
    // the stage's — so swallowing the rejection here only avoids an unhandled one.
    void ask?.().catch(() => undefined);
  };
  const close = () => setDialog(null);

  return { dialog, dialogRef, open, close };
}
