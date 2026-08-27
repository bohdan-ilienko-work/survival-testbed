// What a player who just came back is told, and what the client makes of it.
//
// Its own module because reduceRound is at the 200-line budget and this is the one case there
// that is not about a round happening — it is about a client catching up with one.
//
// `connect` answers with the LOBBY only: the roster, the state, the on-boarding deadline. The
// fight is delivered separately, as a private `playerReconnected`, and that event is therefore
// the whole of what a returning player knows about the match they are standing in.

import { asNum, asYears } from './guards';
import { mergeLiveAnswers } from './liveAnswers';
import type { SurvivalState } from './state';

/**
 * @param p the playerReconnected payload: either a live question to resume, or the instant the
 * pause it landed in ends (`nextRoundAt`). The second half is what used to be missing — a
 * client that came back during a pause was told a round number and nothing else, so it sat on a
 * blank screen while everyone who had stayed watched a countdown.
 */
export function resumeFromReconnect(state: SurvivalState, p: any): SurvivalState {
  const question = p.question;

  if (question) {
    return {
      ...state,
      step: state.iAmEliminated ? 'spectator' : 'question',
      round: p.round ?? state.round,
      mode: question.mode ?? state.mode,
      // Guarded like every other question we take off the wire: the CHRONO panel maps over
      // `years`, and a missing array would throw inside a render rather than read as "no years".
      question: { ...question, years: asYears(question.years), deadline: p.deadline },
      deadline: p.deadline,
      // the round is open, so no pause is running
      nextRoundAt: undefined,
      // `answered: true` means this client's answer is already in — null keeps the panel quiet
      // without inventing a value it never sent.
      myAnswer: p.answered ? state.myAnswer ?? null : state.myAnswer,
      // The board of who answered what, rebuilt rather than replayed: the events that filled it
      // happened while this client was away. Sent only to a player who had already answered, so
      // an empty list here means exactly that — nothing to show.
      liveAnswers: mergeLiveAnswers([], p.answers),
    };
  }

  return {
    ...state,
    round: p.round ?? state.round,
    question: undefined,
    deadline: undefined,
    // null = the server says nothing is pending; undefined = an older build that never says
    nextRoundAt: p.nextRoundAt === null ? undefined : asNum(p.nextRoundAt) ?? state.nextRoundAt,
  };
}
