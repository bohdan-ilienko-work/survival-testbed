// The round itself: a question is handed out, answers land, results and eliminations come back,
// and a tie is broken by a NUMBER round.
//
// One family because every case here is scoped to a SINGLE round — each one either fills or
// clears the same set of per-round fields (question, deadline, myAnswer, scores, eliminated),
// which is exactly what makes `roundStarted` the event that separates two BuyBack windows.

import { asMiss, asNum, asYears } from './guards';
import type { SurvivalState } from './state';
import { NO_OFFER } from './wallet';

/** Answers `undefined` for any event this family does not own, so the dispatcher can move on. */
export function reduceRound(
  state: SurvivalState,
  name: string,
  p: any,
  myPlayerId?: string,
): SurvivalState | undefined {
  switch (name) {
    case 'roundStarted':
      return {
        ...state,
        // a new round means the previous window (and its price) is history
        ...NO_OFFER,
        step: state.iAmEliminated ? 'spectator' : 'question',
        round: p.round ?? state.round,
        mode: p.mode,
        // `years` is re-read through the guard rather than trusted from the spread: the CHRONO
        // panel maps over it, and a string / object / missing array would throw inside a render
        question: {
          ...(p.question ?? {}),
          mode: p.mode,
          years: asYears(p.question?.years),
          deadline: p.deadline,
        },
        deadline: p.deadline,
        // the pause this instant measured is over — the round it announced is the one starting
        nextRoundAt: undefined,
        myAnswer: undefined,
        answeredCount: 0,
        scores: [],
        correctAnswer: undefined,
        // the previous round's survival threshold would mis-explain this round's eliminations
        roundDelta: undefined,
        eliminated: [],
        buybackOpen: false,
      };

    case 'answerReceived':
      return { ...state, answeredCount: state.answeredCount + 1 };

    case 'roundResult': {
      const eliminated: string[] = p.eliminated ?? [];
      const iAmOut = myPlayerId ? eliminated.includes(myPlayerId) : false;
      return {
        ...state,
        step: 'results',
        scores: p.scores ?? [],
        correctAnswer: p.correctAnswer,
        // MAP / NUMBER only, and only when the server named a finite one
        roundDelta: asMiss(p.roundDelta),
        // the answer deadline belongs to the round that just ended — left in place it sat as
        // a red «0 с» timer beside the live pause countdown for the whole between-rounds gap
        deadline: undefined,
        // ABSOLUTE instant of the next roundStarted (C1). On a round that opens a BuyBack
        // window it equals that window's closesAt — the window IS the pause — and on a round
        // that opens none (≤1 active left, round cap, gate unpassable) it is the only
        // countdown the pause has, so it must not depend on any buyback event arriving.
        nextRoundAt: asNum(p.nextRoundAt),
        eliminated,
        iAmEliminated: state.iAmEliminated || iAmOut,
      };
    }

    case 'tiebreakStarted':
      return {
        ...state,
        step: 'question',
        mode: 'NUMBER',
        question: { ...(p.question ?? {}), mode: 'NUMBER', deadline: p.question?.deadline },
        deadline: p.question?.deadline,
        // a tiebreak interrupts the pause — its question must not share the screen with a
        // «наступний раунд» countdown that no longer holds
        nextRoundAt: undefined,
        myAnswer: undefined,
      };

    case 'tiebreakResult':
      return { ...state, step: 'results', scores: p.scores ?? state.scores };

    case 'playerEliminated': {
      const iAmOut = myPlayerId === p.playerId;
      return {
        ...state,
        iAmEliminated: state.iAmEliminated || iAmOut,
        players: state.players.map((pl) =>
          pl.playerId === p.playerId ? { ...pl, eliminated: true } : pl,
        ),
      };
    }

    default:
      return undefined;
  }
}
