// ─── the BuyBack offer ────────────────────────────────────────────────────────
//
// Everything priced in tickets: the per-player offer (its parsing and its one "no offer" value)
// and the ticket balance. One file because the two are a single rule — a balance changes what a
// price means — and because the reducer, the RPC replies and the wallet pushes must all write
// them through the SAME derivation instead of each assigning the fields raw.

import { asBool, asNum, asTag } from './guards';
import type { SurvivalState } from './state';

type OfferFields = Pick<
  SurvivalState,
  | 'buybackCost'
  | 'buybackAttempt'
  | 'buybackMaxUses'
  | 'buybackAffordable'
  | 'buybackClosesAt'
  | 'buybackUnavailableReason'
>;

/**
 * Nothing about one window may survive into the next: a price from round 4 shown next
 * to a live button in round 6 would be a lie about how many tickets the click spends.
 */
export const NO_OFFER: OfferFields = {
  buybackCost: undefined,
  buybackAttempt: undefined,
  buybackMaxUses: undefined,
  buybackAffordable: undefined,
  buybackClosesAt: undefined,
  buybackUnavailableReason: undefined,
};

/** undefined = unknown, so never claim the player cannot pay. */
const canAfford = (cost?: number, balance?: number): boolean | undefined =>
  cost === undefined || balance === undefined ? undefined : balance >= cost;

/**
 * Read the price fields out of a 'buyBackOffer' payload or a getBuyBackQuote reply —
 * the two carry the same fields, so they are parsed in one place to stop them drifting.
 */
export const readOffer = (p: any, prevTickets?: number): OfferFields & { tickets?: number } => {
  const cost = asNum(p.cost);
  const stated = asNum(p.balance);
  const balance = stated ?? prevTickets;
  // `cost: null` means "cannot buy back at all" and is contracted to arrive with a
  // reason; if the reason is missing we still refuse rather than offering a button
  // with no price. A payload with no `cost` KEY at all is merely unknown, not a no.
  const costStated = !!p && typeof p === 'object' && 'cost' in p;
  const unavailableReason =
    asTag(p.unavailableReason) ??
    (costStated && cost === undefined ? 'buyback_not_available' : undefined);
  return {
    buybackCost: cost,
    buybackAttempt: asNum(p.attempt),
    buybackMaxUses: asNum(p.maxUses),
    buybackClosesAt: asNum(p.closesAt),
    buybackUnavailableReason: unavailableReason,
    // trust the server's verdict when it really sent one, else derive it
    buybackAffordable: unavailableReason ? false : asBool(p.affordable, canAfford(cost, balance)),
    // 'ticketsUpdated' is the authority for this number and says so in its own case below. The
    // quoted balance is read from the server's per-match cache, which does not learn about a
    // movement made outside survival-server (main-server's free daily ticket, an IAP, a direct
    // grant), so letting it win would roll a freshly pushed balance BACKWARDS. It is used only
    // to seed the chip when nothing has been pushed yet.
    tickets: prevTickets ?? stated,
  };
};

/**
 * Apply a survival.getBuyBackQuote reply. Same fields as the offer minus round and
 * closesAt, so an existing countdown is kept.
 */
export function applyBuyBackQuote(state: SurvivalState, quote: unknown): SurvivalState {
  if (!quote || typeof quote !== 'object') return state;
  const offer = readOffer(quote, state.tickets);
  return { ...state, ...offer, buybackClosesAt: offer.buybackClosesAt ?? state.buybackClosesAt };
}

/**
 * Apply a new balance and re-derive what it changes.
 *
 * The single place a balance is written, so every source goes through the same re-derivation:
 * the 'ticketsUpdated' push below, and equally a balance learned some other way — beG.getTickets
 * (which also grants the free daily ticket) or a direct grant on main-server. Neither of those
 * passes through survival-server, so neither produces a push; assigning `tickets` raw for them
 * left `buybackAffordable` on its old `false` and the priced Викупитись button dead for the rest
 * of the window, right next to a chip showing enough tickets to pay.
 *
 * A non-numeric or null balance keeps the previous value rather than blanking the chip — the
 * server's balance is legitimately nullable once a finished lobby drops its ticket record.
 */
export function applyTicketBalance(
  state: SurvivalState,
  balance: unknown,
  meta: { delta?: unknown; reason?: unknown } = {},
): SurvivalState {
  const tickets = asNum(balance, state.tickets);
  return {
    ...state,
    tickets,
    ticketsDelta: asNum(meta.delta),
    ticketsReason: asTag(meta.reason),
    // a fresh balance can make an already-quoted price affordable (ad reward, top-up) or not;
    // an unavailable offer stays unavailable whatever the balance says
    buybackAffordable: state.buybackUnavailableReason
      ? false
      : canAfford(state.buybackCost, tickets) ?? state.buybackAffordable,
  };
}
