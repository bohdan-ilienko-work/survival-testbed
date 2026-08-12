// The client's whole survival state: the flowchart step it is on, everything the reducer keeps,
// and the two literals that go with it — the empty state and the Ukrainian label per step.
//
// Kept apart from the reducer so that a module which only needs to NAME the state (a component,
// a guard, the wallet helpers) never has to pull the event handling in behind it.

import type { LobbyPlayer, Question, RankReward, RewardRow, RoundMode, Score } from './wire';

/** Flowchart steps, used only to label what the UI is showing. */
export type Step =
  | 'idle'         // not in a lobby
  | 'lobby'        // 1. Лобі
  | 'starting'     // 2. Старт
  | 'question'     // 3-4. Роздача питань / відповідь
  | 'results'      // 5. Показ відповідей
  | 'buyback'      // 8а. BuyBack
  | 'spectator'    // 8б. Вибув
  | 'finished';    // 10. Фінал

export interface SurvivalState {
  step: Step;
  lobbyId?: string;
  lobbyState?: string;
  scheduledStartAt?: string;
  /**
   * ABSOLUTE unix ms when on-boarding closes and the fight starts — the server's own deadline,
   * never a locally computed `Date.now() + durationMs`. Two reasons it has to be absolute: a
   * duration is measured from the moment the event is HANDLED, so a tab that got the broadcast
   * late counted down to a deadline further away than everyone else's; and `onboardingStarted`
   * fires once, so a tab that connects mid-window never sees it at all and used to show the raw
   * scheduled time with no countdown while another tab in the same lobby counted down beside it.
   */
  onboardingEndsAt?: number;
  players: LobbyPlayer[];
  round: number;
  mode?: RoundMode;
  question?: Question;
  deadline?: number;
  /**
   * ABSOLUTE unix ms when the next round starts — roundResult.nextRoundAt, the server's own
   * instant, absolute for the same reasons as onboardingEndsAt above. On a round that opened a
   * BuyBack window it EQUALS that window's closesAt — the window IS the between-rounds pause —
   * and on a no-window round (≤1 active left, round cap reached, gate unpassable) it is the
   * only pause countdown there is. Cleared on roundStarted: left standing it would keep a
   * «наступний раунд через 0 с» ticking under the live question.
   */
  nextRoundAt?: number;
  myAnswer?: unknown;
  answeredCount: number;
  scores: Score[];
  correctAnswer?: unknown;
  /**
   * MAP / NUMBER only: the miss the round tolerated — everyone off by at most this much stayed
   * in. The server derives it from the field each round (it keeps 70% of the cohort, and the
   * last player kept sets the number), so it belongs to ONE round and has to be cleared when the
   * next one starts: left standing, it would explain the new round's eliminations with the old
   * round's threshold. `undefined` = the server did not name one.
   */
  roundDelta?: number;
  eliminated: string[];
  iAmEliminated: boolean;
  buybackOpen: boolean;

  // ─── the private, PER-PLAYER BuyBack offer ('buyBackOffer' / getBuyBackQuote) ───
  // The price indexes THIS player's used attempts, so none of it may ever come from a
  // broadcast. `undefined` everywhere means "the server has not told us yet".
  /** cost of my next attempt in tickets */
  buybackCost?: number;
  /** 1-based number of the attempt the price is for */
  buybackAttempt?: number;
  /** how many attempts a player gets in total (BUYBACK_MAX_USES) */
  buybackMaxUses?: number;
  /** false = the button stays disabled; undefined = unknown, so let the player try */
  buybackAffordable?: boolean;
  /** unix ms when the window really closes, as armed by the server */
  buybackClosesAt?: number;
  /** machine tag — set means "cannot buy back at all right now" */
  buybackUnavailableReason?: string;

  /** authoritative balance, pushed by the server on every change ('ticketsUpdated') */
  tickets?: number;
  /** last pushed change, kept only to make the push visible while testing */
  ticketsDelta?: number;
  ticketsReason?: string;

  winnerId?: string | null;
  totalRounds?: number;
  /**
   * The endgame payouts, `undefined` until the server states them. Filled from EITHER shape the
   * backend may ship — a `rewards` field inside 'lobbyFinished' or a separate 'lobbyRewards'
   * event — and their order is not guaranteed, so neither write may blank the other's data.
   */
  rewards?: RewardRow[];
  /**
   * What each RANK pays (index 0 = rank 1), as the day's set configured it. Separate from
   * `rewards` on purpose: this labels PLACES, so the board can show what a bot's rank was
   * worth, while `rewards` stays the humans-only list of payouts that actually happened.
   */
  rewardTable?: RankReward[];
  lastError?: string;
}

export const initialState: SurvivalState = {
  step: 'idle',
  players: [],
  round: 0,
  answeredCount: 0,
  scores: [],
  eliminated: [],
  iAmEliminated: false,
  buybackOpen: false,
};

export const stepLabel: Record<Step, string> = {
  idle: '— поза лобі',
  lobby: '1. Лобі',
  starting: '2. Старт матчу',
  question: '3-4. Питання / відповідь',
  results: '5. Показ відповідей',
  buyback: '8а. BuyBack',
  spectator: '8б. Вибув — режим глядача',
  finished: '10. Фінал',
};

/**
 * The humans on a roster. Bots are in it from lobby open now (C2: `playerJoined` fires for
 * "BOT_..." ids and rosterUpdate carries isBot rows from the first broadcast), so any counter
 * that reads players.length is dominated by bots the moment the lobby seeds. One helper so
 * every humans/bots split on screen is derived the same way; the id prefix is checked as well
 * as the flag because a row from an event that predates `isBot` must not promote a bot to
 * human, and playerId is typechecked because rows come off the wire uninspected.
 */
export const countHumans = (players: LobbyPlayer[]): number =>
  players.filter(
    (pl) =>
      pl.isBot !== true && !(typeof pl.playerId === 'string' && pl.playerId.startsWith('BOT_')),
  ).length;
