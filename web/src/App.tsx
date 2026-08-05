import { useMemo, useState } from 'react';
import { errorText, initialState, reduce, type SurvivalState } from './survival';
// Stage first, CharacterEditor second: a stylesheet is emitted where the module that pulls it in
// is first VISITED, so these two lines are what put leaflet.css, then ui.css, then
// characterEditor.css ahead of App.css. Sorting this list would re-sort the cascade with it.
import { Stage } from './components/Stage';
import { CharacterEditor } from './ui/CharacterEditor';
import { Aside } from './components/Aside';
import { BookingDialog } from './components/BookingDialog';
import { Header } from './components/Header';
import { BuyBackQuoteDialog, LobbyStatusDialog } from './components/InspectorDialogs';
import { Toolbar } from './components/Toolbar';
import { useActionRunner } from './hooks/useActionRunner';
import { useBooking } from './hooks/useBooking';
import { useClock } from './hooks/useClock';
import { useDialogs } from './hooks/useDialogs';
import { useGateway } from './hooks/useGateway';
import { useMatchActions } from './hooks/useMatchActions';
import { useMatchEntry } from './hooks/useMatchEntry';
import { useMyLook } from './hooks/useMyLook';
import { useProfileEdits } from './hooks/useProfileEdits';
import { useSession } from './hooks/useSession';
import { useTickets } from './hooks/useTickets';
import type { ActionDeps } from './hooks/types';
import './App.css';
import './ui/shell.css';

export default function App() {
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
  const entry = useMatchEntry(deps, session.setSession, conn.setSurvivalLost);
  const match = useMatchActions(deps, {
    state,
    survivalStatus: conn.status.survival,
    dialogRef: dialogs.dialogRef,
    setDialogError,
    rejoinAndRetry: entry.rejoinAndRetry,
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

  return (
    <div className="app">
      <Header
        gwOnline={conn.gwOnline}
        status={conn.status}
        session={session.session}
        profile={session.profile}
        tickets={state.tickets}
        ticketsReason={state.ticketsReason}
        ticketsDelta={state.ticketsDelta}
      />

      <Toolbar
        busy={busy}
        gwOnline={conn.gwOnline}
        playerId={session.playerId}
        step={state.step}
        onStart={entry.startEverything}
        onConnectAll={entry.connectAll}
        onMockUser={session.mockUser}
        onCharacter={openCharacterEditor}
        onGrantTickets={tickets.grantTickets}
        onRefreshTickets={tickets.refreshTickets}
        onBooking={openBooking}
        onJoin={entry.joinSurvival}
        onLobbyStatus={openLobbyStatus}
        onLeave={entry.leaveSurvival}
        onAd={match.recordAdView}
        onQuote={openQuote}
      />

      <main>
        <Stage
          state={state}
          now={now}
          busy={!!busy}
          playerId={session.playerId}
          survivalLost={conn.survivalLost}
          players={players}
          alive={alive}
          onRestart={entry.startEverything}
          onAnswer={match.submitAnswer}
          onBuyBack={match.buyBack}
          onQuote={match.quoteBuyBack}
        />
        <Aside
          players={players}
          alive={alive}
          playerId={session.playerId}
          events={conn.events}
          logs={conn.logs}
        />
      </main>

      {/* ─── dialogs ──────────────────────────────────────────────────────────────
          Everything here is something you LOOK UP or CHANGE about yourself, never something
          you do during a round: the match panels stay on the stage, where a running timer is
          visible and nothing has to be dismissed to answer a question. */}

      <BookingDialog
        open={dialogs.dialog === 'booking'}
        onClose={dialogs.close}
        status={booking.status}
        me={session.playerId}
        now={now}
        busy={!!busy}
        dialogError={dialogError}
        onRefresh={booking.refresh}
        onMockClan={booking.mockClan}
        onChangeFlag={booking.changeFlag}
        onCharacter={openCharacterEditor}
      />

      <LobbyStatusDialog
        open={dialogs.dialog === 'lobby'}
        onClose={dialogs.close}
        busy={!!busy}
        dialogError={dialogError}
        onRefresh={match.lobbyStatus}
        info={match.lobbyInfo}
        state={state}
        players={players.length}
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
    </div>
  );
}
