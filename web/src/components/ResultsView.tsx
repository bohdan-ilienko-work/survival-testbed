// 5. Показ відповідей — what the round did, per player.
//
// The MAP mode gets a second reading of the same data: a table of coordinates says nothing about
// who was close, so the guesses are drawn on the map they were picked on.
//
// MAP and NUMBER get a third: their eliminations are decided by the miss, not by the score, so
// the round's tolerance and every player's own miss are shown next to the verdict. Reading
// «14 > 9» is the only way a player can tell why they went out — the score column cannot say it.

import { MapPicker } from '../MapPicker';
import { asMiss, tiebreakReasonText, type SurvivalState, type TiebreakInfo } from '../survival';

/**
 * What the sudden death is doing to THIS board, in one sentence per phase.
 *
 * A separate function only because the settled case has two optional halves (the iteration,
 * and the cap it counts against) — spelled inline it was four nested ternaries deep, and the
 * one thing this line must be is readable.
 */
function tiebreakStory(tb: TiebreakInfo): string {
  if (tb.phase === 'pending') {
    return 'Раунд нікого не вибиває сам по собі — зараз прийде додаткове питання, і вибуття вирішить воно.';
  }
  if (tb.phase === 'active') {
    return 'Додаткове питання відкрите — таблиця нижче ще від раунду, який його спричинив.';
  }
  const cap = tb.maxIterations === undefined ? '' : ` з ${tb.maxIterations}`;
  const attempt = tb.iteration === undefined ? '' : ` (спроба ${tb.iteration}${cap})`;
  return `Вибуття вирішило додаткове питання${attempt}, а не бали цього раунду.`;
}

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

      {/* FIRST on the board, before the countdown and the table: the roster just grew by one
          name, and read after the numbers the return is invisible — the player sees the alive
          counter tick UP between rounds and takes it for a bug. Yellow, like the client's own
          announcement line: it is news, not a status. */}
      {state.lastBuyBack && (
        <p className="buyback-note">
          ↩ <b>{state.lastBuyBack.name}</b> викупився назад у гру
        </p>
      )}

      {/* C1: the server's own absolute instant of the next roundStarted. On a round that opened
          a BuyBack window it EQUALS the window's closesAt (the window IS the pause); on one that
          opened none this is the only countdown the pause has. `undefined` = an older server
          that never said — then there is nothing honest to count.

          With `revealEndsAt` the pause is TWO phases: while the reveal runs the board carries
          NO round timer — that is the point of the phase — and only past the boundary does the
          «до наступного раунду» countdown appear. Without it (MAP, a BuyBack window, an older
          server) the countdown runs the whole pause, exactly as before. */}
      {state.nextRoundAt !== undefined &&
        (state.revealEndsAt !== undefined && now < state.revealEndsAt ? (
          <p className="countdown reveal">дивись, хто як відповів</p>
        ) : (
          <p className="countdown">
            до наступного раунду: {Math.max(0, Math.ceil((state.nextRoundAt - now) / 1000))} с
          </p>
        ))}

      {/* WHY this board looks the way it does. A sudden death is not a round — it consumes no
          round number and emits no `roundStarted` — so without this line the player sees an
          extra question appear out of nowhere and, on the all-wrong path, an elimination list
          that no column of the table below can explain. The marker survives `roundResult`
          precisely so it can be read here, where there is finally time to read it. */}
      {state.tiebreak && (
        <p className={`tiebreak-note ${state.tiebreak.phase}`}>
          <b>Тайбрейк — {tiebreakReasonText(state.tiebreak.reason)}.</b> {tiebreakStory(state.tiebreak)}
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

      {/* My own answer, from what THIS client sent — not from the score line. The server's row
          can arrive without it (an answer that landed late, an elimination that got there
          first), and a player whose number vanishes at the reveal reads it as "my answer did
          not count". The table below still shows the server's version; this is what I sent. */}
      {state.myAnswer !== undefined && (
        <p className="my-answer">
          твоя відповідь: <code>{JSON.stringify(state.myAnswer)}</code>
        </p>
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
