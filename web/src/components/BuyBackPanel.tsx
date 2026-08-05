// 8а. BuyBack — the offer panel, and the one part of the fight that spends tickets.
//
// It stays on the STAGE and never becomes a dialog: the window is on a timer, and a price behind
// a backdrop is a price the player has to dismiss something to act on.

import { reasonText, type SurvivalState } from '../survival';

/**
 * Everything the player needs before spending tickets: the price of THIS attempt, which
 * attempt it is (the price rises with every one), the balance it will be taken from and
 * how long the window still stands. All of it comes from the private `buyBackOffer` /
 * getBuyBackQuote — never from the broadcast, which knows nothing about this wallet.
 */
export function BuyBackPanel({
  state,
  now,
  busy,
  onBuyBack,
  onQuote,
}: {
  state: SurvivalState;
  now: number;
  busy: boolean;
  onBuyBack: () => void;
  onQuote: () => void;
}) {
  const cost = state.buybackCost;
  const blocked = state.buybackUnavailableReason;
  // affordable === undefined means "the server has not said" — let the player try and
  // read the real reason from the denial, instead of guessing a no.
  const cannotAfford = !blocked && state.buybackAffordable === false;
  const closesIn =
    state.buybackClosesAt === undefined
      ? null
      : Math.max(0, Math.ceil((state.buybackClosesAt - now) / 1000));

  const attemptLabel =
    state.buybackAttempt === undefined
      ? null
      : state.buybackMaxUses === undefined
        ? `спроба ${state.buybackAttempt}`
        : `спроба ${state.buybackAttempt} з ${state.buybackMaxUses}`;

  return (
    <div className="panel buyback">
      <h2>Ти вибув — але можеш повернутись</h2>

      <div className="offer">
        {attemptLabel && <span className="attempt">{attemptLabel}</span>}
        <span>твій баланс: 🎟 {state.tickets ?? '—'}</span>
        {closesIn !== null && (
          <span className={closesIn <= 5 ? 'hot' : ''}>вікно закриється через {closesIn} с</span>
        )}
      </div>

      <div className="row">
        <button
          className="primary"
          onClick={onBuyBack}
          disabled={busy || !!blocked || cannotAfford}
        >
          {/* an unknown price gets a neutral label — never a wrong number */}
          {cost === undefined ? 'Викупитись' : `Викупитись — 🎟 ${cost}`}
        </button>
        <button onClick={onQuote} disabled={busy}>Оновити ціну</button>
      </div>

      {blocked ? (
        <p className="deny" title={blocked}>
          {reasonText(blocked)}
        </p>
      ) : cannotAfford ? (
        <p className="deny">
          {reasonText('insufficient_tickets')} — подивись рекламу («Реклама +🎟»), і ціна
          перерахується сама.
        </p>
      ) : cost === undefined ? (
        <p className="hint">Ціну ще не отримано від сервера…</p>
      ) : (
        state.buybackMaxUses !== undefined &&
        state.buybackMaxUses > 1 && (
          <p className="hint">Кожна наступна спроба викупу дорожча за попередню.</p>
        )
      )}
    </div>
  );
}
