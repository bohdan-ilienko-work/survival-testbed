// The app's modals, in one place so App.tsx stays layout-sized.
//
// Everything here is something you LOOK UP or CHANGE about yourself, never something you do
// during a round: the match panels stay on the stage, where a running timer is visible and
// nothing has to be dismissed to answer a question.

// CharacterEditor FIRST: a stylesheet is emitted where the module that pulls it in is first
// VISITED, and this import is what puts ui.css (via Modal) then characterEditor.css ahead of
// App.css — the order App.tsx used to pin. Sorting this list would re-sort the cascade with it.
import { CharacterEditor } from '../ui/CharacterEditor';
import { BookingDialog } from './BookingDialog';
import { BuyBackQuoteDialog, LobbyStatusDialog } from './InspectorDialogs';
import type { SurvivalState } from '../survival';
import type { Booking } from '../hooks/useBooking';
import type { Dialogs } from '../hooks/useDialogs';
import type { MatchActions } from '../hooks/useMatchActions';
import type { MyLook } from '../hooks/useMyLook';
import type { ProfileEdits } from '../hooks/useProfileEdits';

export interface AppDialogsProps {
  dialogs: Dialogs;
  state: SurvivalState;
  now: number;
  /** the in-flight label raw: the editor prints it, the modals only need its truthiness */
  busy: string | null;
  dialogError: string | null;
  playerId?: string;
  /** players/alive as the STAGE counted them — the lobby dialog must agree with what is behind it */
  playersCount: number;
  alive: number;
  booking: Booking;
  match: MatchActions;
  edits: ProfileEdits;
  myLook: MyLook;
  /** the shared opener, so the booking dialog's «Персонаж» button refreshes like the toolbar's */
  onCharacter: () => void;
}

export function AppDialogs({
  dialogs,
  state,
  now,
  busy,
  dialogError,
  playerId,
  playersCount,
  alive,
  booking,
  match,
  edits,
  myLook,
  onCharacter,
}: AppDialogsProps) {
  return (
    <>
      <BookingDialog
        open={dialogs.dialog === 'booking'}
        onClose={dialogs.close}
        status={booking.status}
        me={playerId}
        now={now}
        busy={!!busy}
        dialogError={dialogError}
        onRefresh={booking.refresh}
        onMockClan={booking.mockClan}
        onChangeFlag={booking.changeFlag}
        onCharacter={onCharacter}
      />

      <LobbyStatusDialog
        open={dialogs.dialog === 'lobby'}
        onClose={dialogs.close}
        busy={!!busy}
        dialogError={dialogError}
        onRefresh={match.lobbyStatus}
        info={match.lobbyInfo}
        state={state}
        players={playersCount}
        alive={alive}
      />

      <BuyBackQuoteDialog
        open={dialogs.dialog === 'quote'}
        onClose={dialogs.close}
        busy={!!busy}
        dialogError={dialogError}
        onRefresh={match.refreshQuote}
        info={match.quoteInfo}
        state={state}
        now={now}
      />

      {/* The one dialog that WRITES. All three of its calls go through run(), so a refusal comes
          back as a rejection carrying main-server's own wording, which is what the editor puts
          on screen. */}
      <CharacterEditor
        open={dialogs.dialog === 'character'}
        onClose={dialogs.close}
        current={myLook}
        busy={busy}
        onApplyCharacter={edits.applyCharacter}
        onApplyFlag={edits.applyFlag}
        onGrant={edits.grantToPlayer}
      />
    </>
  );
}
