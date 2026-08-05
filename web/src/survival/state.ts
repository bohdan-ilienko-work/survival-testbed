// The client's whole survival state: the flowchart step it is on, everything the reducer keeps,
// and the two literals that go with it — the empty state and the Ukrainian label per step.
//
// Kept apart from the reducer so that a module which only needs to NAME the state (a component,
// a guard, the wallet helpers) never has to pull the event handling in behind it.

import type { LobbyPlayer, Question, RewardRow, RoundMode, Score } from './wire';

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
  myAnswer?: unknown;
  answeredCount: number;
  scores: Score[];
  correctAnswer?: unknown;
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
