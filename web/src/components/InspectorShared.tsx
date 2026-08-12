// What the two read-only inspector dialogs share: the raw-reply block and the prop shape.
//
// Split out of InspectorDialogs when the C3 «лоббі завершене» state pushed that file over the
// 200-line budget — this is the half neither dialog owns alone.

import type { Snapshot } from '../hooks/types';
import type { SurvivalState } from '../survival';

/**
 * A server reply, untouched.
 *
 * The whole reason a testbed exists is to see what actually came back, so the dialogs that ask
 * a question show the raw JSON next to the fields the UI read out of it — that is how a renamed
 * field is caught instead of silently rendering as «—».
 */
export function RawJson({ value }: { value: unknown }) {
  return (
    <div className="ui-scroll-x">
      <pre className="raw-json">
        <code>{JSON.stringify(value, null, 2)}</code>
      </pre>
    </div>
  );
}

export interface InspectorDialogProps {
  open: boolean;
  onClose: () => void;
  busy: boolean;
  dialogError: string | null;
  onRefresh: () => void;
  info: Snapshot | null;
  state: SurvivalState;
}
