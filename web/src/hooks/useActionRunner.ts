// Every button on this screen calls the server through here.
//
// One label at a time (`busy` disables the whole toolbar), one log line per reply, and two ways
// out for a refusal: the stage's error box, or the open dialog. The two exist because they are
// not interchangeable — the stage is behind the backdrop while a dialog is up, so a failure sent
// there during a modal is a failure nobody can read.

import { useCallback, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { Run } from './types';

export interface ActionRunner {
  /** the label of the call in flight, null when idle — also what the toolbar prints */
  busy: string | null;
  run: Run;
  runInDialog: Run;
  /** the last failure raised by a dialog's OWN buttons */
  dialogError: string | null;
  /** written by runInDialog, and by the one call that reports without going through it */
  setDialogError: Dispatch<SetStateAction<string | null>>;
}

/**
 * @param pushLog where every reply and every refusal is written down
 * @param onFailure what to do with a failure that is NOT dialog-scoped — the stage's error box
 */
export function useActionRunner(
  pushLog: (line: string) => void,
  onFailure: (message: string) => void,
): ActionRunner {
  const [busy, setBusy] = useState<string | null>(null);
  /**
   * The last failure raised by a dialog's OWN buttons. It needs somewhere separate to land:
   * run() writes failures into the stage's error box, and the stage is behind the backdrop
   * while a dialog is up — so without this a button inside a modal looks like it did nothing.
   */
  const [dialogError, setDialogError] = useState<string | null>(null);

  // Read at call time, so `run` can keep an empty dependency list and stay identity-stable for
  // the whole life of the app: hooks below close over it inside their own useCallbacks.
  const failRef = useRef(onFailure);
  failRef.current = onFailure;

  const run = useCallback<Run>(
    async (label, fn) => {
      setBusy(label);
      try {
        const res = await fn();
        pushLog(`${label} → ${String(JSON.stringify(res)).slice(0, 300)}`);
        return res;
      } catch (err) {
        pushLog(`${label} ✗ ${(err as Error).message}`);
        failRef.current((err as Error).message);
        throw err;
      } finally {
        setBusy(null);
      }
    },
    [pushLog],
  );

  /**
   * run(), plus the failure lands INSIDE the open dialog.
   *
   * Used by every button that lives in a modal. It swallows the rejection the same way the
   * toolbar's `.catch(() => undefined)` does — the message is already on screen, in the log and
   * in the stage's error box, so re-throwing it would only add an unhandled rejection.
   */
  const runInDialog = useCallback<Run>(
    (label, fn) => {
      setDialogError(null);
      return run(label, fn).catch((err) => {
        setDialogError((err as Error).message);
        return undefined;
      });
    },
    [run],
  );

  return { busy, run, runInDialog, dialogError, setDialogError };
}
