// The LOBBY's own lifecycle, from the first roster broadcast to the payout report: who is
// signed up, when on-boarding opens, when the fight starts, and how the whole thing ends.
//
// One family because none of these events describe a round — they describe the container the
// rounds happen in — and because none of them is addressed to a single player, so this is the
// only reducer file that never needs to know who "I" am.

import { asNum, asPlayers, asRewardTable, asRewards, asTag } from './guards';
import { NO_MATCH } from './match';
import type { SurvivalState } from './state';
import { NO_OFFER } from './wallet';

/** Answers `undefined` for any event this family does not own, so the dispatcher can move on. */
/**
 * A delay on the wire turned into the instant it names. `Date.now()` on purpose: this is the
 * one countdown the server states as a duration, so the clock starts when the event lands.
 */
function startsIn(delayMs: unknown): number | undefined {
  const ms = asNum(delayMs);
  return ms === undefined ? undefined : Date.now() + ms;
}

export function reduceLobby(state: SurvivalState, name: string, p: any): SurvivalState | undefined {
  switch (name) {
    case 'playerJoined':
    case 'playerLeft':
      return {
        ...state,
        step: state.step === 'idle' ? 'lobby' : state.step,
        players: asPlayers(p.roster ?? p.players, state.players),
      };

    case 'rosterUpdate':
      return {
        ...state,
        step: state.step === 'idle' ? 'lobby' : state.step,
        lobbyId: p.lobbyId ?? state.lobbyId,
        lobbyState: p.state ?? state.lobbyState,
        players: asPlayers(p.roster, state.players),
        // The lobby's CURRENT start, re-read on every roster: it can move while we are
        // connected (a set was locked, a set changed, a start was missed), and this reply is
        // the second way that reaches us — see 'lobbyRescheduled' below for the first.
        scheduledStartAt: asTag(p.scheduledStartAt) ?? state.scheduledStartAt,
      };

    // The start moved. Cached once from the connect reply, it would otherwise stay at the old
    // instant for the life of the tab: the countdown hits zero and sits there while the server
    // correctly waits for the new one.
    case 'lobbyRescheduled':
      return {
        ...state,
        lobbyId: p.lobbyId ?? state.lobbyId,
        scheduledStartAt: asTag(p.scheduledStartAt) ?? state.scheduledStartAt,
      };

    case 'onboardingStarted': {
      // `closesAt` is the server's absolute deadline and is preferred whenever it is there;
      // `durationMs` stays as the fallback so an older survival-server keeps working, even
      // though it is the racy one — see the note on SurvivalState.onboardingEndsAt.
      const closesAt = asNum(p.closesAt);
      const durationMs = asNum(p.durationMs);
      const fromDuration = durationMs === undefined ? undefined : Date.now() + durationMs;
      return {
        ...state,
        step: 'lobby',
        lobbyState: 'ONBOARDING',
        onboardingEndsAt: closesAt ?? fromDuration,
        players: asPlayers(p.roster, state.players),
      };
    }

    case 'fightStarted':
      return {
        ...state,
        // A fight starts at round 0 with no board, no verdict and nobody eliminated. NO_MATCH
        // covers the payouts too: without it a finish payload that arrives without rewards let
        // the PREVIOUS match's table resurface under the new final, and this tab's own
        // `iAmEliminated` from the last match put it straight into the spectator step.
        ...NO_MATCH,
        step: 'starting',
        lobbyState: 'ACTIVE',
        onboardingEndsAt: undefined,
        players: asPlayers(p.roster ?? p.players, state.players),
        // How long until the first question. Absent on an older server — then there is simply
        // no countdown, which is honest; guessing the number is what the clients used to do.
        firstRoundAt: startsIn(p.fightStartDelayMs),
        // What the match pays per rank, for the field it ACTUALLY starts with — bots included.
        // Everything the booking screen showed was priced on a human-only roster, so this is
        // the first honest table of the match; NO_MATCH cleared the previous one just above.
        rewardTable: asRewardTable(p.rewardTable),
      };

    case 'playerKickedAfterDisconnect':
      return {
        ...state,
        players: state.players.map((pl) =>
          pl.playerId === p.playerId ? { ...pl, eliminated: true } : pl,
        ),
      };

    case 'fightFinished':
    case 'lobbyFinished':
      return {
        ...state,
        ...NO_OFFER,
        buybackOpen: false,
        step: 'finished',
        // no next round is coming, and the last answer window is over — either instant left
        // ticking on the finish screen would promise a round that will never start
        nextRoundAt: undefined,
        deadline: undefined,
        winnerId: p.winnerId ?? null,
        totalRounds: p.totalRounds ?? state.round,
        // the payouts may ride inside this payload or arrive as their own 'lobbyRewards'
        // event, in either order — so a finish without them must keep what already came
        rewards: asRewards(p.rewards) ?? state.rewards,
        rewardTable: asRewardTable(p.rewardTable) ?? state.rewardTable,
      };

    // The stand-alone shape of the payout report — see the note on state.rewards. It may land
    // before OR after the finish event, so it only stores data and never touches `step`.
    case 'lobbyRewards': {
      // a testbed tab lives across matches; a stale report for another lobby is not this one's
      if (p.lobbyId && state.lobbyId && p.lobbyId !== state.lobbyId) return state;
      return {
        ...state,
        rewards: asRewards(p.rewards) ?? state.rewards,
        rewardTable: asRewardTable(p.rewardTable) ?? state.rewardTable,
      };
    }

    case 'lobbyCancelled':
      return { ...state, step: 'idle', lastError: 'Lobby cancelled' };

    case 'fightError':
      return { ...state, lastError: `Fight error: ${p.reason ?? 'unknown'}` };

    default:
      return undefined;
  }
}
