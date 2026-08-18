// ─── the spectator snapshot (survival.spectate / 'spectatorLobbyChanged') ─────
//
// What a watcher gets, and the guards that stand between it and a render.
//
// A spectator joins nothing: no account, no ticket, no `survival.connect` token, no seat in
// `lobby.players`. None of the player-scoped replies apply to it, so it has exactly ONE reply
// shape to read — this one — which it receives twice over: as the answer to `survival.spectate`,
// and again as the payload of `spectatorLobbyChanged` when the match it was watching ends and
// the server re-points it at the lobby that opened next.
//
// Its own file for the reason booking.ts has one: this is a REPLY, not the event stream.

import { asBool, asIds, asLastResult, asMiss, asNum, asPlayers, asScores, asTag, asYears } from './guards';
import type { LastResult, LobbyPlayer, Question, RoundMode, Score } from './wire';

/**
 * The lobby half of the snapshot — the answer to «чи взагалі щось іде зараз».
 *
 * It is populated in BOOKING and ONBOARDING just as fully as in ACTIVE, and that is the primary
 * case rather than a degraded one: watching the seats fill is exactly what this screen exists
 * for, since until now the only way to know a match was running was to read the server log.
 */
export interface SpectatorLobby {
  lobbyId?: string;
  /** BOOKING | ONBOARDING | ACTIVE | FINISHED | CANCELLED — shown raw, never re-worded */
  state?: string;
  /** ISO string, as the booking reply spells it */
  scheduledStartAt?: string;
  /**
   * ABSOLUTE unix ms when on-boarding closes, `null` when this lobby is not on-boarding.
   * Three-way for the same reason readOnboardingClosesAt is: `undefined` means the server did
   * not say (an older build), which is not the same claim as «не онбордиться».
   */
  onboardingClosesAt?: number | null;
  playerCount?: number;
  activePlayerCount?: number;
  round?: number;
  /** REGISTRATION ORDER IS PART OF THE CONTRACT — never sorted, filtered or de-duplicated */
  roster: LobbyPlayer[];
}

/**
 * The round scored most recently — `FightSnapshot.lastRoundResult`, which is the server's own
 * `roundResult` payload kept back so a watcher who arrived mid-intermission still gets the
 * board the live broadcast already delivered to everyone else.
 */
export interface SpectatorRound {
  round?: number;
  mode?: RoundMode;
  scores: Score[];
  eliminated: string[];
  /** an option id, a [lat, lng] pair, a chrono pairing or a number — printed, never inspected */
  correctAnswer?: unknown;
  roundDelta?: number;
  nextRoundAt?: number;
}

/**
 * The fight half — `null` unless a fight is actually running under an ACTIVE lobby.
 *
 * `answered` is ids and nothing else, deliberately: the server tells a watcher WHO has answered
 * the open round and never WHAT, which is the same line `answerReceived` has always drawn so
 * that a watcher cannot relay a rival's live answer to a colluding player.
 */
export interface SpectatorFight {
  fightId?: string;
  /** IDLE | ROUND_ACTIVE | ROUND_SCORING | TIEBREAK_ACTIVE | BUYBACK_WINDOW | INTERMISSION | FINISHED */
  state?: string;
  round?: number;
  mode?: RoundMode;
  /** the correct answer is already stripped server-side; absent unless a round is OPEN now */
  question?: Question;
  deadline?: number;
  answered: string[];
  nextRoundAt?: number;
  buyback?: { closesAt?: number; eliminatedIds: string[] };
  lastRoundResult?: SpectatorRound;
}

export interface SpectatorSnapshot {
  /**
   * The server's own marker that this really is a spectator snapshot. Read rather than assumed:
   * a renamed field on the server would otherwise arrive as a whole screen of «—» with nothing
   * saying why, and this flag is the one thing that can tell a tester the shape changed.
   */
  spectator: boolean;
  /** the server's `Date.now()` at build time — what lets a skewed browser clock be corrected */
  serverNow?: number;
  /** how many sockets are watching; public load, no identity */
  viewers?: number;
  /** `null` = there is no lobby at all, which is a real answer and not a missing field */
  lobby: SpectatorLobby | null;
  fight: SpectatorFight | null;
  /** the board of the last FINISHED lobby, while it is still inside the server's window */
  lastResult?: LastResult;
  /** when THIS tab received it — the local half of the clock-skew subtraction */
  at: number;
}

const objOf = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : {};

/**
 * The live question, shaped exactly as `roundStarted` shapes it in reduceRound — `years` re-read
 * through its own guard, `mode` and `deadline` stamped from the fight rather than trusted from
 * inside the question, so one reader cannot produce a question the other panel cannot draw.
 */
function readQuestion(raw: unknown, mode?: RoundMode, deadline?: number): Question | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const q = raw as Record<string, unknown>;
  return {
    ...(q as unknown as Question),
    mode: mode ?? ((asTag(q.mode) as RoundMode | undefined) ?? 'QUESTION'),
    years: asYears(q.years),
    deadline,
  };
}

/** `roundNumber` is what RoundResult calls it; `round` is accepted too, so neither spelling loses. */
function readRound(raw: unknown): SpectatorRound | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  return {
    round: asNum(r.roundNumber) ?? asNum(r.round),
    mode: asTag(r.mode) as RoundMode | undefined,
    scores: asScores(r.scores) ?? [],
    eliminated: asIds(r.eliminated),
    correctAnswer: r.correctAnswer,
    roundDelta: asMiss(r.roundDelta),
    nextRoundAt: asNum(r.nextRoundAt),
  };
}

function readFight(raw: unknown): SpectatorFight | null {
  if (!raw || typeof raw !== 'object') return null;
  const f = raw as Record<string, unknown>;
  const mode = asTag(f.mode) as RoundMode | undefined;
  const deadline = asNum(f.deadline);
  const bb = f.buyback;
  return {
    fightId: asTag(f.fightId),
    state: asTag(f.state),
    round: asNum(f.round),
    mode,
    question: readQuestion(f.question, mode, deadline),
    deadline,
    answered: asIds(f.answered),
    nextRoundAt: asNum(f.nextRoundAt),
    buyback:
      bb && typeof bb === 'object'
        ? {
            closesAt: asNum(objOf(bb).closesAt),
            eliminatedIds: asIds(objOf(bb).eliminatedIds),
          }
        : undefined,
    lastRoundResult: readRound(f.lastRoundResult),
  };
}

function readLobby(raw: unknown): SpectatorLobby | null {
  if (!raw || typeof raw !== 'object') return null;
  const l = raw as Record<string, unknown>;
  return {
    lobbyId: asTag(l.lobbyId),
    state: asTag(l.state),
    scheduledStartAt: asTag(l.scheduledStartAt),
    // the three-way read: absent key → undefined, explicit null → null, number → number
    onboardingClosesAt:
      'onboardingClosesAt' in l
        ? l.onboardingClosesAt === null
          ? null
          : asNum(l.onboardingClosesAt)
        : undefined,
    playerCount: asNum(l.playerCount),
    activePlayerCount: asNum(l.activePlayerCount),
    round: asNum(l.round),
    // no roster is an empty list, never a crash — and an empty lobby is a legitimate answer
    roster: asPlayers(l.roster, []),
  };
}

/**
 * Read one spectator snapshot. Every branch degrades into "the server did not say" rather than
 * throwing, for the reason readBookingStatus does: this screen is drawn for somebody who joined
 * nothing, so it has no second source — a renamed field must show up as a blank cell beside a
 * raw reply, never as a blank page.
 */
export function readSpectatorSnapshot(reply: unknown): SpectatorSnapshot {
  const r = objOf(reply);
  return {
    spectator: asBool(r.spectator) ?? false,
    serverNow: asNum(r.serverNow),
    viewers: asNum(r.viewers),
    lobby: readLobby(r.lobby),
    fight: readFight(r.fight),
    lastResult: asLastResult(r.lastResult),
    at: Date.now(),
  };
}
