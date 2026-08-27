// Хто як відповів — while the round is still running.
//
// Shown only once this client's own answer is in, because that is the only case the server ever
// sends the board for: `answersRevealed` is addressed to players who have already committed. The
// panel is therefore not gated on a rule of its own — an empty list simply means nothing has
// been revealed to us yet, and the «чекаємо» line says exactly that.

import type { LiveAnswer, SurvivalState } from '../survival';
import { describeAnswer } from '../survival';

/** Seconds from the round's start, the way the results board prints them. */
function atLabel(elapsedMs: number): string {
  return `${(Math.max(0, elapsedMs) / 1000).toFixed(1)} с`;
}

export function LiveAnswers({ state, me }: { state: SurvivalState; me?: string }) {
  // Nothing to show before this client has answered: the server sends the board to nobody else.
  if (state.myAnswer === undefined) return null;

  const rows: LiveAnswer[] = state.liveAnswers;
  const waiting = Math.max(0, state.players.filter((p) => !p.eliminated).length - rows.length);

  return (
    <div className="panel live-answers">
      <h2>Хто як відповів</h2>
      {rows.length === 0 ? (
        <p className="hint">
          Твоя відповідь прийнята. Щойно хтось відповість — його відповідь зʼявиться тут.
        </p>
      ) : (
        <ol className="answer-feed">
          {rows.map((row) => (
            <li key={row.playerId} className={row.playerId === me ? 'mine' : undefined}>
              <span className="who">{row.name || row.playerId}</span>
              <span className="what">{describeAnswer(row.value, state.question)}</span>
              <span className="when">{atLabel(row.elapsedMs)}</span>
            </li>
          ))}
        </ol>
      )}
      {waiting > 0 && (
        <p className="hint small">
          Ще думають: {waiting}. Правильна відповідь — на екрані результатів.
        </p>
      )}
    </div>
  );
}
