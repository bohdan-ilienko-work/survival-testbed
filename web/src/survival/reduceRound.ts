// The round itself: a question is handed out, answers land, results and eliminations come back,
// and a tie — or a round nobody got right — is settled by a sudden-death decider.
//
// One family because every case here is scoped to a SINGLE round — each one either fills or
// clears the same set of per-round fields (question, deadline, myAnswer, scores, eliminated),
// which is exactly what makes `roundStarted` the event that separates two BuyBack windows.

import { asIds, asMiss, asNum, asScores, asTag, asYears } from './guards';
import type { SurvivalState } from './state';
import { mergeRoundResultTiebreak, readTiebreak } from './tiebreak';
import { NO_OFFER } from './wallet';
import type { RoundMode } from './wire';

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
        // an ORDINARY round: a marker left standing would label it a sudden death
        tiebreak: undefined,
      };

    case 'answerReceived':
      return { ...state, answeredCount: state.answeredCount + 1 };

    case 'roundResult': {
      // Guarded, not trusted: the results table sorts on `rank`, rounds `score` and prints
      // `err` beside the round's threshold, so one string where a number is declared renders
      // as NaN in the very cell that is supposed to explain who went out and why. The
      // spectator snapshot reads the same rows through the same guard — one shape, one reader.
      const eliminated = asIds(p.eliminated);
      const iAmOut = myPlayerId ? eliminated.includes(myPlayerId) : false;
      return {
        ...state,
        step: 'results',
        // The FINISHED round's mode, put back. A decider leaves `mode` as its own (NUMBER /
        // MAP), and without this the QUESTION or CHRONO board that follows would be drawn with
        // a «похибка» column and a proximity threshold neither of them ever had.
        mode: (asTag(p.mode) as RoundMode | undefined) ?? state.mode,
        scores: asScores(p.scores) ?? [],
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
        // WHY this board looks the way it does. Deliberately not cleared here — see
        // mergeRoundResultTiebreak.
        tiebreak: mergeRoundResultTiebreak(state.tiebreak, p),
      };
    }

    // The reveal pause: the round is scored, nobody got it right, and the decider question is
    // not open yet. It is the ONE moment the player is told why another question is about to
    // appear, so it lands on the results step carrying the finished round's own board.
    //
    // No `deadline` and no `nextRoundAt`: nothing is being answered and no ordinary round is
    // coming — the marker's `startsAt` is the only countdown this window has.
    case 'tiebreakPending': {
      const reveal = p.roundReveal && typeof p.roundReveal === 'object' ? p.roundReveal : {};
      return {
        ...state,
        step: 'results',
        mode: (asTag(reveal.mode) as RoundMode | undefined) ?? state.mode,
        scores: asScores(reveal.scores) ?? state.scores,
        correctAnswer: 'correctAnswer' in reveal ? reveal.correctAnswer : state.correctAnswer,
        deadline: undefined,
        nextRoundAt: undefined,
        tiebreak: readTiebreak(p, 'pending'),
      };
    }

    case 'tiebreakStarted': {
      // The mode is READ, not assumed. It used to be hardcoded 'NUMBER', which drew a MAP
      // sudden death as a number input — a question the player physically could not answer.
      const mode = (asTag(p.mode) as RoundMode | undefined) ?? p.question?.mode ?? 'NUMBER';
      // Top level first, the way `roundStarted` spells it; inside the question is where it
      // used to be, and both have to keep working while server and client are out of step.
      const deadline = asNum(p.deadline) ?? asNum(p.question?.deadline);
      return {
        ...state,
        // An eliminated player WATCHES a decider, exactly as they watch a round. The step used
        // to be forced to 'question', which handed a dead player a live answer panel.
        step: state.iAmEliminated ? 'spectator' : 'question',
        mode,
        question: {
          ...(p.question ?? {}),
          mode,
          years: asYears(p.question?.years),
          deadline,
        },
        deadline,
        // a tiebreak interrupts the pause — its question must not share the screen with a
        // «наступний раунд» countdown that no longer holds
        nextRoundAt: undefined,
        myAnswer: undefined,
        // The server counts the DECIDER's answers from zero, so a count left over from the round
        // that caused the tiebreak would sit above the decider claiming answers nobody has sent.
        answeredCount: 0,
        tiebreak: readTiebreak(p, 'active', state.tiebreak),
      };
    }

    case 'tiebreakResult':
      return {
        ...state,
        step: 'results',
        // The DECIDER's own board, so its mode is what makes the miss column readable — a
        // decider is MAP or NUMBER and every line carries an `err`. `roundResult` puts the
        // finished round's mode back a moment later.
        mode: (asTag(p.mode) as RoundMode | undefined) ?? state.mode,
        // a non-array is "the server did not say" and must keep the round's own scores standing,
        // exactly as it did before — the guard only changes WHAT a present array is trusted for
        scores: asScores(p.scores) ?? state.scores,
        // present only when a question was actually asked; a deterministic settle asks none
        correctAnswer: 'correctAnswer' in p ? p.correctAnswer : state.correctAnswer,
        deadline: undefined,
        tiebreak: readTiebreak(p, 'done', state.tiebreak),
      };

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
