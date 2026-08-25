// Layout only: which panel sits where, and which wired value feeds which prop.
// The hooks and their mutual wiring live in hooks/useAppWiring; the modals in
// components/AppDialogs.

// Stage first, AppDialogs second: a stylesheet is emitted where the module that pulls it in
// is first VISITED, so these two lines are what put leaflet.css (via the Stage's map), then
// ui.css and characterEditor.css (via the dialogs) ahead of App.css. Sorting this list would
// re-sort the cascade with it.
import { Stage } from './components/Stage';
// After Stage: it pulls the same QuestionView → MapPicker → leaflet.css chain, so importing it
// first would move leaflet.css ahead of the line above and re-sort the cascade for nothing.
import { SpectatorView } from './components/SpectatorView';
import { AppDialogs } from './components/AppDialogs';
import { Aside } from './components/Aside';
import { Header } from './components/Header';
import { Toolbar } from './components/Toolbar';
import { useAppWiring } from './hooks/useAppWiring';
import './App.css';
import './ui/shell.css';

export default function App() {
  const w = useAppWiring();
  const { state, conn, session, entry, match, now, busy, players, alive, spectator } = w;

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
        nextMatchAt={w.nextMatchAt}
        now={now}
      />

      <Toolbar
        busy={busy}
        gwOnline={conn.gwOnline}
        playerId={session.playerId}
        step={state.step}
        onStart={entry.startEverything}
        onConnectAll={entry.connectAll}
        onMockUser={session.mockUser}
        onCharacter={w.openCharacterEditor}
        onGrantTickets={w.tickets.grantTickets}
        onRefreshTickets={w.tickets.refreshTickets}
        onBooking={w.openBooking}
        onJoin={entry.joinSurvival}
        onLobbyStatus={w.openLobbyStatus}
        onLeave={entry.leaveSurvival}
        onUnregister={w.booking.unregister}
        onAd={match.recordAdView}
        onAdTicket={w.tickets.claimAdTicket}
        onQuote={w.openQuote}
        onRules={w.openRules}
        onBuyTickets={w.openTicketShop}
        watching={spectator.watching}
        onWatch={spectator.watch}
        onStopWatching={spectator.stopWatching}
      />

      <main>
        {/* Watching REPLACES the stage rather than sitting under it: a watcher is not a player
            on a step, so the match panels below would be describing a match this tab is not in.
            The server enforces the same exclusivity — `spectate` refuses a socket that already
            holds a paid binding with 'already_in_match'. */}
        {spectator.watching ? (
          <SpectatorView
            feed={spectator.feed}
            now={now}
            busy={!!busy}
            survivalLost={conn.survivalLost}
            // the shared error box is the stage's, and the watch screen took the stage's place
            error={state.lastError}
            onWatch={spectator.watch}
          />
        ) : (
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
        )}
        <Aside
          players={players}
          alive={alive}
          playerId={session.playerId}
          events={conn.events}
          logs={conn.logs}
        />
      </main>

      <AppDialogs
        dialogs={w.dialogs}
        state={state}
        now={now}
        busy={busy}
        dialogError={w.dialogError}
        playerId={session.playerId}
        playersCount={players.length}
        alive={alive}
        booking={w.booking}
        match={match}
        tickets={w.tickets}
        edits={w.edits}
        myLook={w.myLook}
        onCharacter={w.openCharacterEditor}
      />
    </div>
  );
}
