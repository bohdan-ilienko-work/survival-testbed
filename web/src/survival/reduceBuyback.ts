// BuyBack and the wallet: the broadcast window, the private per-player offer and its denial,
// the revive itself, and the authoritative ticket push.
//
// One family because every case here is about the SAME question — may this player pay to come
// back, and for how much — and because all but the window broadcasts are addressed to one
// socket, so each of them has to check the payload really is mine before it renders it as mine.

import { asNum, asTag } from './guards';
import { isHardDenial, reasonWithTag } from './reasons';
import type { SurvivalState } from './state';
import { NO_OFFER, applyTicketBalance, readOffer } from './wallet';

/** Answers `undefined` for any event this family does not own, so the dispatcher can move on. */
export function reduceBuyback(
  state: SurvivalState,
  name: string,
  p: any,
  myPlayerId?: string,
): SurvivalState | undefined {
  switch (name) {
    // Broadcast, and deliberately carries no wallet data: the price comes from the
    // private 'buyBackOffer' instead. It must NOT clear the offer — the two events are
    // emitted together and their order is not guaranteed, so clearing here could wipe
    // a price that already arrived. `roundStarted` is what separates two windows.
    case 'buybackWindowOpen':
      return {
        ...state,
        step: state.iAmEliminated ? 'buyback' : state.step,
        buybackOpen: true,
      };

    case 'buybackWindowClosed':
      return {
        ...state,
        ...NO_OFFER,
        buybackOpen: false,
        step: state.iAmEliminated ? 'spectator' : state.step,
      };

    case 'buyBackSuccess': {
      const mine = myPlayerId === p.playerId;
      // Somebody ELSE coming back does not close my window — it only makes the roster
      // bigger, which can loosen the "too few players left" gate. Drop the stale offer
      // so the UI re-quotes instead of keeping a verdict that may no longer hold.
      const dropOffer = mine || state.buybackOpen;
      return {
        ...state,
        ...(dropOffer ? NO_OFFER : {}),
        buybackOpen: mine ? false : state.buybackOpen,
        iAmEliminated: mine ? false : state.iAmEliminated,
        step: mine ? 'question' : state.step,
        // never read a balance out of an event addressed to another player
        tickets: mine ? asNum(p.balance, state.tickets) : state.tickets,
        players: state.players.map((pl) =>
          pl.playerId === p.playerId ? { ...pl, eliminated: false } : pl,
        ),
      };
    }

    case 'buyBackDenied': {
      // Private wallet event. The server addresses it to one socket; ignoring a
      // mis-addressed payload turns a server-side privacy bug into a no-op instead of
      // showing this player somebody else's denial.
      if (myPlayerId && p.playerId && p.playerId !== myPlayerId) return state;
      const tag = asTag(p.reason);
      return {
        ...state,
        lastError: `Викуп відхилено: ${reasonWithTag(tag)}`,
        // a permanent denial must also kill the button for the rest of the window
        buybackUnavailableReason: isHardDenial(tag) ? tag : state.buybackUnavailableReason,
        // not enough tickets can be fixed by an ad, so keep it recoverable
        buybackAffordable: tag === 'insufficient_tickets' ? false : state.buybackAffordable,
      };
    }

    case 'ticketsUpdated': {
      if (myPlayerId && p.playerId && p.playerId !== myPlayerId) return state;
      // Authoritative: the server pushes on every real balance change, so this wins over
      // whatever an RPC reply left behind.
      return applyTicketBalance(state, p.balance ?? p.tickets, { delta: p.delta, reason: p.reason });
    }

    // Private, PER-PLAYER: the price indexes THIS player's used attempts, so a payload
    // addressed to anybody else must not be rendered as mine.
    case 'buyBackOffer': {
      if (myPlayerId && p.playerId && p.playerId !== myPlayerId) return state;
      return {
        ...state,
        ...readOffer(p, state.tickets),
        // the offer can arrive before the broadcast, so it opens the panel on its own
        buybackOpen: true,
        step: state.iAmEliminated ? 'buyback' : state.step,
      };
    }

    default:
      return undefined;
  }
}
