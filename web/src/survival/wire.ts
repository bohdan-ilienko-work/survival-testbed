// The shapes that arrive on the wire: a roster row, a question, a score, a payout row.
//
// A LEAF module on purpose — it imports nothing, so the guards, the state and every reducer
// family can name these types without ever closing an import cycle back onto their own code.

export type RoundMode = 'QUESTION' | 'CHRONO' | 'MAP' | 'NUMBER';

/**
 * One roster row. Everything but `playerId` is optional on purpose: the same type is filled
 * from the lobby broadcasts (`rosterUpdate`, `fightStarted`, `survival.connect`) AND from the
 * booking roster beG.getSurvivalStatus passes through, and those sources do not all carry the
 * same fields.
 */
export interface LobbyPlayer {
  playerId: string;
  name?: string;
  /** avatar index picked at sign-up (0..28); drawn as a portrait — see gameAssets.characterIconUrl */
  character?: number;
  /** ISO-3166 alpha-2 country code — 'UN' when main-server could not geolocate the IP */
  flag?: string;
  /**
   * Clan NAME, '' when the player is in no clan (bots are always ''). survival-server has no
   * clans collection, so main-server resolves the clan id off the player document — but only
   * once, inside RegisterPlayer, so the row keeps the clan the player had when they signed up.
   */
  clan?: string;
  /** null for the whole of BOOKING — slots are handed out when on-boarding starts */
  slot?: number | null;
  isBot?: boolean;
  eliminated?: boolean;
  eliminatedAtRound?: number | null;
  ready?: boolean;
}

export interface Question {
  id?: string | number;
  mode: RoundMode;
  text?: string;
  /** server sends objects, not plain strings — see SelectionOption in scoring.ts */
  options?: { id: number; text: string }[];
  events?: { id: number; text: string }[];
  /**
   * CHRONO only: the set's years, SHUFFLED as the server shows them. CHRONO is a MATCHING
   * round — the answer pairs events[i] with a year BY INDEX into this array — so the array
   * itself is the address space of the answer and never gets reordered on the client.
   */
  years?: number[];
  imageUrl?: string;
  deadline?: number;
}

export interface Score {
  playerId: string;
  score: number;
  correct: boolean;
  rank: number;
  answer?: unknown;
  /**
   * MAP / NUMBER only: how far this answer missed, in the question's own unit (kilometres for
   * MAP). It is what elimination is decided on there — `score` is a display figure — so this is
   * the number that has to sit next to the ✓/✗ for a result to be readable. A player who did not
   * answer holds `Infinity` on the server, which JSON ships as `null`.
   */
  err?: number;
}

/**
 * One endgame payout row, as survival-server computes it: the OVERALL final rank (bots consume
 * ranks too) and what main-server is told to pay for it. The contract sends humans only and
 * omits all-zero rows, but nothing here relies on that — a bot row or a zero row is rendered
 * fine, because the testbed's job is to show what actually arrived.
 */
export interface RewardRow {
  playerId: string;
  rank?: number;
  gems?: number;
  tickets?: number;
}

/**
 * What one RANK pays, as the day's set configured it — index 0 is rank 1.
 *
 * Deliberately NOT the same thing as RewardRow. The table describes places, so it can label a
 * bot's rank too; a RewardRow describes a player and carries only the humans main-server
 * actually bills for. Showing the table beside a bot is information; showing it a RewardRow
 * would be a claim that money moved.
 */
export interface RankReward {
  gems: number;
  tickets: number;
}
