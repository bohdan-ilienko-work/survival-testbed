// The composition root: every state hook the screen is made of, wired into one another.
//
// This used to live inline in App.tsx; it moved here so App is left with layout only. Nothing
// below is new — the order of the calls and the two circular closures are exactly what they
// were, and the comments on them say why they must stay that way.

import { useMemo, useState } from 'react';
import { errorText, initialState, reduce } from '../survival';
import type { LobbyPlayer, SurvivalState } from '../survival';
import { useActionRunner } from './useActionRunner';
import { useBooking, type Booking } from './useBooking';
import { useClock } from './useClock';
import { useDialogs, type Dialogs } from './useDialogs';
import { useGateway, type GatewayConnection } from './useGateway';
import { useMatchActions, type MatchActions } from './useMatchActions';
import { useMatchEntry, type MatchEntry } from './useMatchEntry';
import { useMyLook, type MyLook } from './useMyLook';
import { useProfileEdits, type ProfileEdits } from './useProfileEdits';
import { useSession, type SessionState } from './useSession';
import { useTickets, type Tickets } from './useTickets';
import type { ActionDeps } from './types';

export interface AppWiring {
  now: number;
  state: SurvivalState;
  conn: GatewayConnection;
  /** the label of the call in flight, null when idle — the modals only need its truthiness */
  busy: string | null;
  dialogError: string | null;
  dialogs: Dialogs;
  session: SessionState;
  booking: Booking;
  tickets: Tickets;
  entry: MatchEntry;
  match: MatchActions;
  edits: ProfileEdits;
  /** state.players guarded ONCE, so the stage and the dialogs count the same array */
  players: LobbyPlayer[];
  alive: number;
  myLook: MyLook;
  openBooking: () => void;
  openLobbyStatus: () => void;
  openQuote: () => void;
  openCharacterEditor: () => void;
}

export function useAppWiring(): AppWiring {
  const now = useClock();
  const [state, setState] = useState<SurvivalState>(initialState);

  // The socket. Both handlers are closures the WEBSOCKET calls, never this render, so naming a
  // hook declared further down is safe — and unavoidable: the session needs a gateway to sign in
  // through, and the gateway needs a session to sign in as.
  const conn = useGateway({
    onOpen: (gateway) => void session.signIn(gateway),
    onSurvivalEvent: (ev) => setState((s) => reduce(s, ev, session.playerIdRef.current)),
  });

  const { busy, run, runInDialog, dialogError, setDialogError } = useActionRunner(
    conn.pushLog,
    // survival.buyBack rejects with the server's machine reason ('insufficient_tickets'),
    // not a sentence. errorText translates a known tag and passes real prose through.
    (message) => setState((s) => ({ ...s, lastError: errorText(message) })),
  );

  const deps: ActionDeps = useMemo(
    () => ({ gw: conn.gw, run, runInDialog, pushLog: conn.pushLog, setState }),
    [conn.gw, conn.pushLog, run, runInDialog],
  );

  const dialogs = useDialogs(() => setDialogError(null));
  // The reset list is mockUser's: a new player inherits nothing from the one being replaced.
  const session = useSession(deps, () => {
    setState(initialState);
    booking.forget();
    match.forgetSnapshots();
  });
  const booking = useBooking(deps, session.setProfile);
  const tickets = useTickets(deps, state.step);
  // booking.fetchBooking doubles as the C4 pre-join gate's status read (see joinPolicy)
  const entry = useMatchEntry(deps, session.setSession, conn.setSurvivalLost, booking.fetchBooking);
  const match = useMatchActions(deps, {
    state,
    survivalStatus: conn.status.survival,
    dialogRef: dialogs.dialogRef,
    setDialogError,
    rejoinAndRetry: entry.rejoinAndRetry,
    resetAndReenter: entry.resetAndReenter,
  });
  const edits = useProfileEdits(deps, {
    playerId: session.playerId,
    setProfile: session.setProfile,
    fetchProfile: session.fetchProfile,
    fetchBooking: booking.fetchBooking,
  });

  const players = Array.isArray(state.players) ? state.players : [];
  const alive = players.filter((p) => !p.eliminated).length;
  const myLook = useMyLook(session.playerId, session.profile, booking.status, state.players);

  const openBooking = () => dialogs.open('booking', booking.refresh);
  const openLobbyStatus = () => dialogs.open('lobby', match.lobbyStatus);
  const openQuote = () => dialogs.open('quote', match.quoteBuyBack);
  const openCharacterEditor = () =>
    // Refresh what the editor calls «зараз»: without it the editor falls back to the roster's
    // registration-time copy, which a previous edit already invalidated. A miss only means that
    // fallback stays — the reason is in the log.
    dialogs.open('character', () => run('beG.getContext', session.fetchProfile));

  return {
    now,
    state,
    conn,
    busy,
    dialogError,
    dialogs,
    session,
    booking,
    tickets,
    entry,
    match,
    edits,
    players,
    alive,
    myLook,
    openBooking,
    openLobbyStatus,
    openQuote,
    openCharacterEditor,
  };
}
