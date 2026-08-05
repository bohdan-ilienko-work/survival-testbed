// The round itself: a question is handed out, answers land, results and eliminations come back,
// and a tie is broken by a NUMBER round.
//
// One family because every case here is scoped to a SINGLE round — each one either fills or
// clears the same set of per-round fields (question, deadline, myAnswer, scores, eliminated),
// which is exactly what makes `roundStarted` the event that separates two BuyBack windows.

import { asYears } from './guards';
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
        myAnswer: undefined,
        answeredCount: 0,
        scores: [],
        correctAnswer: undefined,
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
