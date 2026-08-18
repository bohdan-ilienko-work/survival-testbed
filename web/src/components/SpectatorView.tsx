// The watch screen: the whole stage, for a tab that joined nothing.
//
// It REPLACES the stage rather than sitting inside it, because a watcher is not a player on a
// step — its state machine is the fight's, not its own, and the player panels underneath would
// be describing a match this tab is not in.
//
// Every panel below is one the player already has. That is the point: a spectator's round is
// the same round, so QuestionView draws the question (disabled, as it draws an eliminated
// player's), ResultsView draws the board and FinishView draws the final. A parallel set would
// be two renderings of one payload, free to disagree — which is the bug a testbed exists to
// catch, not to contain.

import { lastResultBoard, stepLabel, type LobbyPlayer, type SpectatorFeed } from '../survival';
import { ClientStateTable } from './ClientStateTable';
import { FinishView } from './FinishView';
import { QuestionView } from './QuestionView';
import { ResultsView } from './ResultsView';
import { SpectatorLobbyCard } from './SpectatorLobbyCard';

/**
 * A spectator can never act. The server would refuse anyway — every mutating RPC resolves its
 * caller through a gate that answers `null` for a watching socket — but the panel is handed a
 * dead callback so nothing on screen can even offer to try.
 */
const NO_ACTION = () => undefined;

export interface SpectatorViewProps {
  feed: SpectatorFeed;
  /** the shared wall clock; the skew correction is applied here, once, for the whole screen */
  now: number;
  busy: boolean;
  /** the survival socket dropped — the match on screen is a ghost of one */
  survivalLost: boolean;
  /** the last refusal the shared error box holds (a spectate that came back 'too_fast', …) */
  error?: string;
  /** survival.spectate again: the re-sync, and the recovery after a dropped socket */
  onWatch: () => void;
}

export function SpectatorView({
  feed,
  now,
  busy,
  survivalLost,
  error,
  onWatch,
}: SpectatorViewProps) {
  const st = feed.state;
  // THE server's clock, not this browser's. Every instant in the snapshot and in every event is
  // absolute epoch ms as the SERVER stamped it, so a machine whose clock is a minute out would
  // count every deadline a minute wrong; `serverNow` is what makes that correctable, and it is
  // corrected once here so no panel below can forget to.
  const clock = now + feed.skewMs;
  const players: LobbyPlayer[] = Array.isArray(st.players) ? st.players : [];
  const alive = players.filter((p) => !p.eliminated).length;

  // The answer timer belongs to an OPEN round only: during the results / buyback pause the round
  // it timed is over, and a dead red «0s» beside the live pause countdown says nothing true.
  const secondsLeft =
    st.step === 'question' && st.deadline !== undefined
      ? Math.max(0, Math.round((st.deadline - clock) / 1000))
      : null;

  // The board of a finished match. Live state wins while it has one ('lobbyFinished' carries the
  // payouts); otherwise it is the snapshot's `lastResult` — which after a rotation is the ONLY
  // copy of the match that just ended, since the live state now describes the lobby that opened.
  const watchingRound = st.step === 'question' || st.step === 'results';
  const board =
    st.step === 'finished'
      ? st
      : !watchingRound && feed.lastResult
        ? lastResultBoard(feed.lastResult)
        : null;

  return (
    <div className="stage">
      <div className="stepbar">
        <b>👁 Глядач · {stepLabel[st.step]}</b>
        {st.round > 0 && <span>раунд {st.round}</span>}
        {st.mode && <span className="mode">{st.mode}</span>}
        {feed.viewers !== undefined && <span className="viewers">глядачів {feed.viewers}</span>}
        {secondsLeft !== null && (
          <span className={`timer ${secondsLeft <= 5 ? 'hot' : ''}`}>{secondsLeft}s</span>
        )}
      </div>

      {survivalLost && (
        <div className="error stale">
          <b>Звʼязок із survival-server втрачено.</b> Місце глядача живе на сокеті — після
          обриву його треба зайняти заново.
          <button className="primary" onClick={onWatch} disabled={busy}>
            Дивитись знову
          </button>
        </div>
      )}

      {feed.wrongShape && (
        <div className="error">
          Відповідь без <code>spectator: true</code> — схоже, сервер змінив форму знімка.
          Дивись сирий JSON у логах праворуч.
        </div>
      )}

      {error && <div className="error">{error}</div>}

      <SpectatorLobbyCard feed={feed} now={clock} />

      {st.step === 'question' && st.question && (
        <>
          <QuestionView state={st} disabled onAnswer={NO_ACTION} />
          <AnsweredBy ids={feed.answeredIds} players={players} />
        </>
      )}

      {st.step === 'results' && <ResultsView state={st} now={clock} />}

      {board && (
        <div className="watched-board">
          <FinishView state={board} />
        </div>
      )}

      <ClientStateTable state={st} alive={alive} total={players.length} />
      <p className="hint small">
        Знімок: {feed.at ? new Date(feed.at).toLocaleTimeString() : '—'} · розсинхрон годинника з
        сервером: {feed.skewMs} мс. Далі екран живе на тих самих публічних подіях, які отримують
        гравці — приватних (ціна викупу, баланс, токени) глядачеві не надсилають узагалі.
      </p>
    </div>
  );
}

/**
 * WHO has already answered the open round.
 *
 * Names, never answers: `answerReceived` carries `{ playerId, round }` and nothing more, exactly
 * so a watcher cannot relay a rival's live answer to a colluding player. This list is the whole
 * of what the server is willing to say, rendered as it arrived.
 */
function AnsweredBy({ ids, players }: { ids: string[]; players: LobbyPlayer[] }) {
  const nameOf = (id: string): string => {
    const row = players.find((p) => p.playerId === id);
    return (typeof row?.name === 'string' && row.name.trim()) || id.slice(0, 12);
  };
  return (
    <p className="answered-by">
      <span className="lbl">уже відповіли ({ids.length}):</span>{' '}
      {ids.length === 0 ? (
        <em>поки ніхто</em>
      ) : (
        ids.map((id) => (
          <span className="answerer" key={id} title={id}>
            {nameOf(id)}
          </span>
        ))
      )}
    </p>
  );
}
