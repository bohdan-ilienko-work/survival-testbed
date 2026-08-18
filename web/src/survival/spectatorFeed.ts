// ─── what the watcher is looking at ───────────────────────────────────────────
//
// The spectator's whole client state: a SurvivalState built from the snapshot, kept current by
// the public event stream, plus the handful of facts only a watcher has (how many others are
// watching, how far its clock is from the server's, who has answered the open round).
//
// It is a SurvivalState on purpose, and a SEPARATE one from the player's. Separate, because a
// watching tab is bound to no lobby: feeding the player's reducer would build a ghost match for
// a tab that never joined. A SurvivalState, because a watcher and a player look at the same
// round — so QuestionView, ResultsView and FinishView draw both, instead of the testbed growing
// a second set of panels that can disagree with the first.

import type { ServerEvent } from '../gateway';
import { asTag } from './guards';
import { eventPayload, reduce } from './reduce';
import { initialState, type Step, type SurvivalState } from './state';
import { readSpectatorSnapshot, type SpectatorFight, type SpectatorLobby, type SpectatorSnapshot } from './spectator';
import type { LastResult } from './wire';

export interface SpectatorFeed {
  /** this tab holds a spectator seat — the one flag that swaps the stage for the watch screen */
  watching: boolean;
  /** the watched match, in the shape every match panel already knows how to draw */
  state: SurvivalState;
  /**
   * `serverNow - Date.now()` at the last snapshot. Every instant on this screen is the SERVER's
   * absolute epoch ms, so a browser clock a minute out would count every deadline a minute
   * wrong; this is the offset that puts the watcher back on the players' clock.
   */
  skewMs: number;
  /** how many sockets are watching, as of the last snapshot */
  viewers?: number;
  /**
   * WHO has answered the open round. Ids only — the server never says WHAT, deliberately, so
   * that a watcher cannot relay a rival's live answer to a colluding player.
   */
  answeredIds: string[];
  /** the fight's own state machine, shown raw: it is the evidence a testbed exists to print */
  fightState?: string;
  /** the server's own counts; the roster length is only a fallback for a reply without them */
  playerCount?: number;
  activePlayerCount?: number;
  /** the board of the last finished lobby, as the snapshot carried it */
  lastResult?: LastResult;
  /** local ms of the last snapshot; `undefined` = never asked */
  at?: number;
  /** the reply carried no `spectator: true` — the shape is not what this reader expects */
  wrongShape: boolean;
}

export const emptySpectatorFeed: SpectatorFeed = {
  watching: false,
  state: initialState,
  skewMs: 0,
  answeredIds: [],
  wrongShape: false,
};

/**
 * Which step the snapshot lands on.
 *
 * A FINISHED lobby is deliberately NOT step 'finished': a snapshot carries no payout table, so
 * the endgame board comes from `lastResult` instead (see lastResultBoard). The live path is a
 * different thing — 'lobbyFinished' brings the rewards with it and does set 'finished'.
 */
function stepFor(lobby: SpectatorLobby | null, fight: SpectatorFight | null): Step {
  if (!lobby) return 'idle';
  if (fight?.question) return 'question';
  if (fight?.lastRoundResult) return 'results';
  if (fight || lobby.state === 'ACTIVE') return 'starting';
  return 'lobby';
}

/**
 * Adopt a snapshot — the `spectate` reply and the `spectatorLobbyChanged` payload alike.
 *
 * A full REPLACE, built from initialState rather than merged into what is on screen. The
 * snapshot is complete by contract (lobby + fight + lastResult), and the one moment it arrives
 * unprompted is a lobby ROTATION, where merging is exactly wrong: the previous match's roster,
 * round number and scores would survive into a lobby that has none of them.
 */
export function applySpectatorSnapshot(snap: SpectatorSnapshot): SpectatorFeed {
  const { lobby, fight } = snap;
  // The round that is OPEN right now, if any. Everything below splits on it, because a live
  // round and a scored round fill the SAME SurvivalState fields and only one of them may be
  // adopted: the previous round's correctAnswer sitting under a live question is the exact leak
  // `roundStarted` clears, and its nextRoundAt is an instant already in the past — which reads
  // on screen as «наступний раунд через 0 с» ticking under a question that just started.
  const live = fight?.question;
  const scored = fight && !live ? fight.lastRoundResult : undefined;

  return {
    watching: true,
    at: snap.at,
    skewMs: snap.serverNow === undefined ? 0 : snap.serverNow - snap.at,
    viewers: snap.viewers,
    answeredIds: fight?.answered ?? [],
    fightState: fight?.state,
    playerCount: lobby?.playerCount,
    activePlayerCount: lobby?.activePlayerCount,
    lastResult: snap.lastResult,
    wrongShape: !snap.spectator,
    state: {
      ...initialState,
      step: stepFor(lobby, fight),
      lobbyId: lobby?.lobbyId,
      lobbyState: lobby?.state,
      scheduledStartAt: lobby?.scheduledStartAt,
      // null = "this lobby is not on-boarding", which must not arm a countdown
      onboardingEndsAt: lobby?.onboardingClosesAt ?? undefined,
      players: lobby?.roster ?? [],
      round: fight?.round ?? lobby?.round ?? 0,
      mode: fight?.mode ?? scored?.mode,
      question: live,
      deadline: live ? fight?.deadline : undefined,
      nextRoundAt: live ? undefined : fight?.nextRoundAt,
      answeredCount: fight?.answered.length ?? 0,
      scores: scored?.scores ?? [],
      correctAnswer: scored?.correctAnswer,
      roundDelta: scored?.roundDelta,
      eliminated: scored?.eliminated ?? [],
      buybackOpen: !!fight?.buyback,
      buybackClosesAt: fight?.buyback?.closesAt,
    },
  };
}

/**
 * The endgame board of a finished match, as a SurvivalState — so FinishView draws the match a
 * watcher just saw end exactly as it draws a player's own final. Its own value rather than
 * folded into `state`: after a rotation the live state describes the lobby that just OPENED,
 * and writing the old match's roster and winner into it would put the previous match's players
 * on the new lobby's screen.
 */
export function lastResultBoard(last: LastResult): SurvivalState {
  return {
    ...initialState,
    step: 'finished',
    lobbyId: last.lobbyId,
    lobbyState: 'FINISHED',
    players: last.roster ?? [],
    winnerId: last.winnerId ?? null,
    totalRounds: last.totalRounds,
    rewards: last.rewards,
    rewardTable: last.rewardTable,
  };
}

/**
 * Who has answered the open round.
 *
 * `answerReceived` is the ONLY thing the server says about a live round's answers, and it says
 * a name and nothing more. De-duplicated because a re-delivered event would otherwise read as
 * one more player being in, and cleared by the two events that open a round — a tiebreak is a
 * round of its own, with its own set of answers.
 */
function nextAnswered(current: string[], name: string, p: any): string[] {
  if (name === 'roundStarted' || name === 'tiebreakStarted') {
    return current.length === 0 ? current : [];
  }
  if (name !== 'answerReceived') return current;
  const id = asTag(p?.playerId);
  if (!id || current.includes(id)) return current;
  return [...current, id];
}

/**
 * One server event, folded into the feed. Everything but `spectatorLobbyChanged` goes through
 * the app's own `reduce` with NO player id: a watcher is nobody in this match, so nothing is
 * ever "mine" — and no private event can reach this socket to be mis-read as one. That is the
 * design in a line: the fan-out was not extended for spectators, only its membership was.
 */
export function reduceSpectator(feed: SpectatorFeed, ev: ServerEvent): SpectatorFeed {
  // Not watching: the events belong to the player binding, and this feed has no claim on them.
  if (!feed.watching) return feed;

  const p = eventPayload(ev.args);
  if (ev.name === 'spectatorLobbyChanged') {
    return applySpectatorSnapshot(readSpectatorSnapshot(p));
  }

  const state = reduce(feed.state, ev, undefined);
  const answeredIds = nextAnswered(feed.answeredIds, ev.name, p);
  // A new fight's board is not the previous match's. Without this, a watcher who joined inside
  // the 120 s freshness window would keep match A's finish table on screen for the whole of
  // match B — and see it again the moment B finished.
  const lastResult = ev.name === 'fightStarted' ? undefined : feed.lastResult;

  if (state === feed.state && answeredIds === feed.answeredIds && lastResult === feed.lastResult) {
    return feed;
  }
  return {
    ...feed,
    // one source of truth for the count: the ids, so the footnote under a question can never
    // disagree with the list of names beside it
    state: { ...state, answeredCount: answeredIds.length },
    answeredIds,
    lastResult,
  };
}
