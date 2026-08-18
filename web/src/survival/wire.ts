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

/**
 * The `lastResult` block a survival.connect reply may carry (C3) — present only for a human
 * participant of the LAST finished lobby, and only within 120 s of the finish. It exists so a
 * tab that reloaded across the end of its match still gets the payout screen: the finish
 * broadcasts went out while this socket did not exist, and this block is the only place they
 * can be re-learned. Every field is optional because each is guarded off the wire on its own —
 * a broken roster must not cost the payouts sitting next to it.
 */
export interface LastResult {
  lobbyId?: string;
  /** ABSOLUTE unix ms of the finish — the instant the 120 s freshness window counts from */
  finishedAt?: number;
  winnerId?: string;
  totalRounds?: number;
  rewards?: RewardRow[];
  rewardTable?: RankReward[];
  roster?: LobbyPlayer[];
}

/**
 * WHY a sudden-death round is being played.
 *
 *   'all_wrong'    — nobody answered the round correctly, so the round has no honest way to
 *                    eliminate anyone: a decider question is played instead of letting the
 *                    whole-lobby tie throw everybody out.
 *   'boundary_tie' — the round's own rule left two or more players inseparable on the cut line.
 *
 * A machine TAG and not a sentence, for the reason reasons.ts exists: the Ukrainian words are
 * built in ./tiebreak, and a tag a newer server invents still renders as a marker (with the
 * cause left unnamed) instead of blanking the whole badge.
 */
export type TiebreakReason = 'all_wrong' | 'boundary_tie';

/**
 * The sudden-death marker the client holds while one is happening.
 *
 * Every field but `phase` and `playerIds` is optional because the three events that fill it say
 * different amounts: the reveal (`tiebreakPending`) knows WHY and WHEN the decider opens but has
 * no iteration yet, `tiebreakStarted` knows the iteration and the decider's mode, and
 * `roundResult` closes the round carrying only the reason. So the marker is MERGED across them
 * rather than replaced — see readTiebreak — and a field nobody stated stays «сервер не сказав».
 */
export interface TiebreakInfo {
  reason?: TiebreakReason;
  /** 1-based decider round inside this tiebreak; unknown during the reveal pause */
  iteration?: number;
  /** the cap the server will stop at (SURVIVAL_MAX_TIEBREAK_ROUNDS) — the «2/5» denominator */
  maxIterations?: number;
  /** who is contesting it. Empty = the server did not say, never "nobody" */
  playerIds: string[];
  /**
   * ABSOLUTE unix ms when the decider question opens — the reveal pause's own deadline, and the
   * ONLY countdown there is in that window: the round's answer deadline is spent and
   * `nextRoundAt` is deliberately null while a tiebreak is pending.
   */
  startsAt?: number;
  /** the DECIDER's mode (MAP / NUMBER), which is not the finished round's mode */
  mode?: RoundMode;
  /**
   * Where in the sudden death we are, and the one field that is always known:
   *   'pending' — the reveal pause, no answers accepted, `startsAt` counts down
   *   'active'  — a decider question is open right now
   *   'done'    — it has been settled; the marker stays so the results board can say why
   */
  phase: 'pending' | 'active' | 'done';
}
