// «Стан клієнта (як його бачить UI)» — the reducer's own output, spelled out.
//
// Not a debug leftover: every row here is a field the panels above only show indirectly, and the
// difference between "the server did not say" and "the server said zero" is exactly what this
// screen exists to make visible — which is why «—» and «не знаю» are never collapsed into 0.

import type { SurvivalState } from '../survival';
import { playersLeftLabel } from './peopleWords';

export function ClientStateTable({
  state,
  alive,
  total,
}: {
  state: SurvivalState;
  alive: number;
  total: number;
}) {
  return (
    <details className="raw">
      <summary>Стан клієнта (як його бачить UI)</summary>
      <table>
        <tbody>
          <tr><td>крок</td><td>{state.step}</td></tr>
          <tr><td>лоббі</td><td>{state.lobbyId ?? '—'} · {state.lobbyState ?? '—'}</td></tr>
          <tr><td>раунд / режим</td><td>{state.round} · {state.mode ?? '—'}</td></tr>
          <tr><td>питання</td><td>{state.question ? 'є' : 'немає'}</td></tr>
          <tr><td>моя відповідь</td><td>{state.myAnswer === undefined ? '—' : JSON.stringify(state.myAnswer)}</td></tr>
          <tr>
            <td>відповіді інших</td>
            <td>
              {state.liveAnswers.length === 0
                ? state.myAnswer === undefined
                  ? '— (поки не відповів — і не має приходити)'
                  : '— (ще ніхто не відповів)'
                : state.liveAnswers.map((a) => a.name || a.playerId).join(', ')}
            </td>
          </tr>
          <tr><td>вибув</td><td>{state.iAmEliminated ? 'так' : 'ні'}</td></tr>
          <tr>
            <td>тікети</td>
            <td>
              {state.tickets ?? '—'}
              {state.ticketsReason ? ` · ${state.ticketsReason}` : ''}
              {state.ticketsDelta === undefined
                ? ''
                : ` (${state.ticketsDelta > 0 ? '+' : ''}${state.ticketsDelta})`}
            </td>
          </tr>
          <tr>
            <td>викуп (приватна ціна)</td>
            <td>
              ціна {state.buybackCost ?? '—'} · поспіль {state.buybackAttempt ?? '—'}/
              {state.buybackMaxUses ?? '—'} · по кишені:{' '}
              {state.buybackAffordable === undefined
                ? '?'
                : state.buybackAffordable
                  ? 'так'
                  : 'ні'}
              {state.buybackUnavailableReason ? ` · ${state.buybackUnavailableReason}` : ''}
            </td>
          </tr>
          <tr>
            <td>пауза між раундами</td>
            <td>
              {/* raw epoch ms on purpose: under C1 a buyback round's nextRoundAt EQUALS the
                  window's closesAt — two identical numbers side by side IS the check, and a
                  formatted time would round the difference away */}
              revealEndsAt: {state.revealEndsAt ?? '—'} · nextRoundAt: {state.nextRoundAt ?? '—'}{' '}
              · buyback closesAt: {state.buybackClosesAt ?? '—'}
            </td>
          </tr>
          <tr>
            <td>нагороди (фінал)</td>
            <td>
              {state.rewards === undefined
                ? 'не знаю — сервер не прислав'
                : `${state.rewards.length} рядків`}
            </td>
          </tr>
          <tr>
            <td>тайбрейк</td>
            <td>
              {/* The marker as the reducer holds it. Raw, like every other row here: «фаза» is
                  what says whether answers are open, and the cohort is what says who is
                  actually playing the decider. */}
              {state.tiebreak === undefined
                ? '—'
                : `${state.tiebreak.phase} · ${state.tiebreak.reason ?? 'причини нема'} · ` +
                  `${state.tiebreak.iteration ?? '—'}/${state.tiebreak.maxIterations ?? '—'} · ` +
                  `грають ${state.tiebreak.playerIds.length}`}
            </td>
          </tr>
          <tr><td>гравців</td><td>{alive} / {total} · {playersLeftLabel(alive)}</td></tr>
        </tbody>
      </table>
    </details>
  );
}
