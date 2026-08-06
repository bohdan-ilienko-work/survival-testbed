// The LOBBY's own lifecycle, from the first roster broadcast to the payout report: who is
// signed up, when on-boarding opens, when the fight starts, and how the whole thing ends.
//
// One family because none of these events describe a round — they describe the container the
// rounds happen in — and because none of them is addressed to a single player, so this is the
// only reducer file that never needs to know who "I" am.

import { asNum, asPlayers, asRewardTable, asRewards } from './guards';
import type { SurvivalState } from './state';
import { NO_OFFER } from './wallet';

/** Answers `undefined` for any event this family does not own, so the dispatcher can move on. */
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
        step: 'starting',
        lobbyState: 'ACTIVE',
        onboardingEndsAt: undefined,
        players: asPlayers(p.roster ?? p.players, state.players),
        // a new fight starts with no payouts: without this, a finish payload that arrives
        // without rewards would let the PREVIOUS match's table resurface under the new final
        rewards: undefined,
        rewardTable: undefined,
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
