// 5. Показ відповідей — what the round did, per player.
//
// The MAP mode gets a second reading of the same data: a table of coordinates says nothing about
// who was close, so the guesses are drawn on the map they were picked on.
//
// MAP and NUMBER get a third: their eliminations are decided by the miss, not by the score, so
// the round's tolerance and every player's own miss are shown next to the verdict. Reading
// «14 > 9» is the only way a player can tell why they went out — the score column cannot say it.

import { MapPicker } from '../MapPicker';
import { asMiss, type SurvivalState } from '../survival';

export function ResultsView({ state, me, now }: { state: SurvivalState; me?: string; now: number }) {
  // the two modes the floating delta decides; QUESTION / CHRONO carry no miss at all
  const byMiss = state.mode === 'MAP' || state.mode === 'NUMBER';
  const unit = state.mode === 'MAP' ? ' км' : '';
  const fmt = (miss?: number) =>
    miss === undefined ? '—' : `${Math.round(miss * 100) / 100}${unit}`;

  const correctPoint =
    state.mode === 'MAP' && Array.isArray(state.correctAnswer)
      ? { lat: Number(state.correctAnswer[0]), lng: Number(state.correctAnswer[1]) }
      : null;

  const guesses = state.scores
    .map((sc) => {
      const a = sc.answer as { type?: string; lat?: number; lng?: number } | null;
      if (!a || a.type !== 'map' || typeof a.lat !== 'number') return null;
      return {
        lat: a.lat,
        lng: a.lng as number,
        label: `${sc.playerId === me ? 'Я' : sc.playerId.slice(0, 12)} · ранг ${sc.rank}`,
        mine: sc.playerId === me,
      };
    })
    .filter(Boolean) as { lat: number; lng: number; label: string; mine: boolean }[];

  return (
    <div className="panel results">
      <h2>Результат раунду {state.round}</h2>

      {/* C1: the server's own absolute instant of the next roundStarted. On a round that opened
          a BuyBack window it EQUALS the window's closesAt (the window IS the pause); on one that
          opened none this is the only countdown the pause has. `undefined` = an older server
          that never said — then there is nothing honest to count. */}
      {state.nextRoundAt !== undefined && (
        <p className="countdown">
          наступний раунд через {Math.max(0, Math.ceil((state.nextRoundAt - now) / 1000))} с
        </p>
      )}

      {correctPoint && (
        <div style={{ marginBottom: 14 }}>
          <MapPicker correct={correctPoint} guesses={guesses} disabled height={260} />
          <p className="answered">
            🟢 правильна точка · 🔵 твоя відповідь · 🔴 інші гравці
          </p>
        </div>
      )}

      {state.correctAnswer !== undefined && !correctPoint && (
        <p>правильна відповідь: <code>{JSON.stringify(state.correctAnswer)}</code></p>
      )}

      {byMiss && (
        <p className="answered">
          {state.roundDelta === undefined
            ? 'поріг раунду сервер не назвав — раунд вирішує додатковий'
            : `поріг раунду ±${fmt(state.roundDelta)} — хто промахнувся більше, вибуває`}
        </p>
      )}

      <table>
        <thead>
          <tr>
            <th>#</th><th>гравець</th><th>відповідь</th>
            {byMiss && <th>похибка</th>}
            <th>очки</th><th />
          </tr>
        </thead>
        <tbody>
          {[...state.scores].sort((a, b) => a.rank - b.rank).map((s) => {
            const miss = asMiss(s.err);
            // `>` only when both numbers are real: an unanswered round has no threshold to beat
            const overshot =
              miss !== undefined && state.roundDelta !== undefined && miss > state.roundDelta;
            return (
              <tr key={s.playerId} className={state.eliminated.includes(s.playerId) ? 'out' : ''}>
                <td>{s.rank}</td>
                <td><code>{s.playerId === me ? 'Я' : String(s.playerId).slice(0, 12)}</code></td>
                <td><code>{s.answer === undefined ? '—' : String(JSON.stringify(s.answer)).slice(0, 40)}</code></td>
                {byMiss && (
                  <td>{overshot ? `${fmt(miss)} > ${fmt(state.roundDelta)}` : fmt(miss)}</td>
                )}
                <td>{Math.round(s.score * 100) / 100}</td>
                <td>
                  {s.correct ? '✅' : '❌'}
                  {state.eliminated.includes(s.playerId) ? ' вибув' : ''}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
