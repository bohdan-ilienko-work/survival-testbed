// «Стан клієнта (як його бачить UI)» — the reducer's own output, spelled out.
//
// Not a debug leftover: every row here is a field the panels above only show indirectly, and the
// difference between "the server did not say" and "the server said zero" is exactly what this
// screen exists to make visible — which is why «—» and «не знаю» are never collapsed into 0.

import type { SurvivalState } from '../survival';

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
              ціна {state.buybackCost ?? '—'} · спроба {state.buybackAttempt ?? '—'}/
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
            <td>нагороди (фінал)</td>
            <td>
              {state.rewards === undefined
                ? 'не знаю — сервер не прислав'
                : `${state.rewards.length} рядків`}
            </td>
          </tr>
          <tr><td>гравців</td><td>{alive} / {total}</td></tr>
        </tbody>
      </table>
    </details>
  );
}
