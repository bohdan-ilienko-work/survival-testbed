// 5. Показ відповідей — what the round did, per player.
//
// The MAP mode gets a second reading of the same data: a table of coordinates says nothing about
// who was close, so the guesses are drawn on the map they were picked on.

import { MapPicker } from '../MapPicker';
import type { SurvivalState } from '../survival';

export function ResultsView({ state, me }: { state: SurvivalState; me?: string }) {
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
      <table>
        <thead>
          <tr><th>#</th><th>гравець</th><th>відповідь</th><th>очки</th><th /></tr>
        </thead>
        <tbody>
          {[...state.scores].sort((a, b) => a.rank - b.rank).map((s) => (
            <tr key={s.playerId} className={state.eliminated.includes(s.playerId) ? 'out' : ''}>
              <td>{s.rank}</td>
              <td><code>{s.playerId === me ? 'Я' : String(s.playerId).slice(0, 12)}</code></td>
              <td><code>{s.answer === undefined ? '—' : String(JSON.stringify(s.answer)).slice(0, 40)}</code></td>
              <td>{Math.round(s.score * 100) / 100}</td>
              <td>
                {s.correct ? '✅' : '❌'}
                {state.eliminated.includes(s.playerId) ? ' вибув' : ''}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
