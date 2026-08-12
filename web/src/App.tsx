// Layout only: which panel sits where, and which wired value feeds which prop.
// The hooks and their mutual wiring live in hooks/useAppWiring; the modals in
// components/AppDialogs.

// Stage first, AppDialogs second: a stylesheet is emitted where the module that pulls it in
// is first VISITED, so these two lines are what put leaflet.css (via the Stage's map), then
// ui.css and characterEditor.css (via the dialogs) ahead of App.css. Sorting this list would
// re-sort the cascade with it.
import { Stage } from './components/Stage';
import { AppDialogs } from './components/AppDialogs';
import { Aside } from './components/Aside';
import { Header } from './components/Header';
import { Toolbar } from './components/Toolbar';
import { useAppWiring } from './hooks/useAppWiring';
import './App.css';
import './ui/shell.css';

export default function App() {
  const w = useAppWiring();
  const { state, conn, session, entry, match, now, busy, players, alive } = w;

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
        onCharacter={w.openCharacterEditor}
        onGrantTickets={w.tickets.grantTickets}
        onRefreshTickets={w.tickets.refreshTickets}
        onBooking={w.openBooking}
        onJoin={entry.joinSurvival}
        onLobbyStatus={w.openLobbyStatus}
        onLeave={entry.leaveSurvival}
        onAd={match.recordAdView}
        onQuote={w.openQuote}
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
        edits={w.edits}
        myLook={w.myLook}
        onCharacter={w.openCharacterEditor}
      />
    </div>
  );
}
