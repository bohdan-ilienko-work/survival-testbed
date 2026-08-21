// What a knocked-out player is told, and why they are still looking at the match.
//
// Two things used to be missing at exactly the moment they matter most. A round that opens NO
// buy-back window says so only through the absence of one — the player sits on a results board
// waiting for an offer that is never coming. And nothing on screen says that being out is not
// being ejected: the match stays open, the roster keeps updating, and leaving is the player's
// own decision, never the app's.

import { reasonText, type SurvivalState } from '../survival';

/** Why no buy-back is coming, in the player's words. Undefined = one may still open. */
function noBuyBackReason(state: SurvivalState): string | undefined {
  // Round-level first: the server refused a window to EVERYONE this round (a final between two
  // players, too few left for the gate). It rides on roundResult, so it is known before any
  // offer would have arrived — which is the whole point, since none is coming.
  const round = reasonText(state.roundBuybackUnavailableReason);
  if (round) return round;
  // Then this player's own hard denial from a window that DID open (attempts spent, and such).
  return reasonText(state.buybackUnavailableReason);
}

export function EliminatedNotice({ state }: { state: SurvivalState }) {
  if (!state.iAmEliminated) return null;
  // While the window is open the BuyBack panel IS the message, and a second one beside it would
  // only compete with the countdown.
  if (state.step === 'buyback') return null;

  const blocked = noBuyBackReason(state);
  const windowMayOpen = state.buybackClosesAt !== undefined && !blocked;

  return (
    <div className={`panel eliminated${blocked ? ' final' : ''}`}>
      <h2>{blocked ? 'Ти вибув — це кінець турніру для тебе' : 'Ти вибув'}</h2>

      {blocked ? (
        <p className="deny">Викупитись не вийде: {blocked}.</p>
      ) : windowMayOpen ? (
        <p className="hint">Вікно викупу відкривається — зараз зʼявиться пропозиція з ціною.</p>
      ) : (
        <p className="hint">
          Якщо сервер відкриє вікно викупу, воно зʼявиться тут само — до кінця паузи між
          раундами.
        </p>
      )}

      {/* The counterpart of the client's rule: nothing takes the player out of the match on its
          own. They watch the rest of it, and the roster on the right keeps them oriented. */}
      <p className="hint small">
        Матч нікуди не дівається: ти лишаєшся глядачем і бачиш ростер та решту раундів. Вийти —
        тільки самому, кнопкою вгорі.
      </p>
    </div>
  );
}
