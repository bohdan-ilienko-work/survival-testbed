// Nothing off the wire is trusted: one guard per shape the state declares, each one degrading a
// wrong / missing value into "the server did not say" instead of letting it reach a render.
//
// They live together because every comment below is the same lesson learned on a different field,
// and because the composite guards (asYears, asRewards) are built out of the scalar ones.

import type { LastResult, LobbyPlayer, RankReward, RewardRow } from './wire';

/**
 * Some events carry `players` as a COUNT (onboardingStarted) and others as a LIST
 * (fightStarted). Blindly trusting the field once turned state.players into a number
 * and crashed every render that called .filter on it.
 */
export const asPlayers = (value: unknown, fallback: LobbyPlayer[]): LobbyPlayer[] =>
  Array.isArray(value) ? (value as LobbyPlayer[]) : fallback;

/**
 * Numeric twin of asPlayers, and for the same reason. The wallet numbers (cost,
 * balance, attempt, closesAt) go straight into comparisons, arithmetic and the label
 * on a button that spends tickets, so a string / null / missing value arriving where
 * `number` is declared must never be stored as-is.
 * `undefined` is deliberately kept as "not known" — it is not the same as 0.
 */
export const asNum = (value: unknown, fallback?: number): number | undefined => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : fallback;
  // JSON keeps numbers as numbers, but a payload built by hand can still send "4"
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
};

/**
 * The CHRONO year strip, guarded like every other array on the wire.
 *
 * All-or-nothing, deliberately: the answer addresses a year by its INDEX here, so dropping one
 * bad element would shift every index after it and silently mis-pair the rest of the set. A
 * missing / non-array / partly non-numeric value therefore degrades to `undefined` — "no years",
 * which the round panel renders as a message instead of crashing on .map — never to a shorter
 * array. Strings are accepted the same way asNum accepts them: JSON keeps numbers as numbers,
 * but a payload built by hand can still send "1969".
 */
export const asYears = (value: unknown): number[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const years: number[] = [];
  for (const raw of value) {
    const year = asNum(raw);
    if (year === undefined) return undefined;
    years.push(year);
  }
  return years;
};

/**
 * A miss or a tolerance in the question's own unit (kilometres on MAP). Never negative, and
 * never infinite: a player who did not answer holds `Infinity` server-side, which JSON ships as
 * `null`, and a round whose cut landed on such a player has no threshold worth naming. Both
 * degrade to `undefined`, which the results screen shows as «—» rather than printing a
 * tolerance that would explain the round's eliminations wrongly.
 */
export const asMiss = (value: unknown): number | undefined => {
  const miss = asNum(value);
  return miss === undefined || miss < 0 ? undefined : miss;
};

/** Only a real boolean is a verdict; anything else means "the server did not say". */
export const asBool = (value: unknown, fallback?: boolean): boolean | undefined =>
  typeof value === 'boolean' ? value : fallback;

/** Machine reason tags are short non-empty strings; '' and non-strings are no tag. */
export const asTag = (value: unknown): string | undefined => {
  const tag = typeof value === 'string' ? value.trim() : '';
  return tag === '' ? undefined : tag;
};

/**
 * Read the `rewardTable` — what each RANK pays, index 0 = rank 1. It is the day's set config,
 * public information, and it is what lets the endgame board label a rank nobody was paid for
 * (every bot's, and every human below the paid places). `undefined` for a missing table keeps
 * "старий сервер" distinguishable from "таблиця порожня".
 */
export const asRewardTable = (value: unknown): RankReward[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  return value.map((raw) => {
    const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
    // A rank that pays nothing is a real row: it still occupies a place in the table, and
    // dropping it would shift every rank below it up by one.
    return { gems: asNum(r.gems) ?? 0, tickets: asNum(r.tickets) ?? 0 };
  });
};

/**
 * Read a `rewards` array off the wire, guarded like everything else: a missing or non-array
 * value answers `undefined` ("сервер не сказав" — an OLD survival-server sends no rewards at
 * all), never a crash. Rows are kept per-field: a row with a bad rank still shows its payout.
 */
export const asRewards = (value: unknown): RewardRow[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const rows: RewardRow[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    // no playerId → nobody to attribute the payout to, so the row is unrenderable
    if (typeof r.playerId !== 'string' || r.playerId === '') continue;
    rows.push({
      playerId: r.playerId,
      rank: asNum(r.rank),
      gems: asNum(r.gems),
      tickets: asNum(r.tickets),
    });
  }
  return rows;
};

/**
 * Read the connect reply's `lastResult` block (C3) — the finish snapshot for a tab that
 * reloaded across the end of its match. Fields are guarded individually, absent → undefined,
 * so a partly broken block still delivers what it can: the payouts matter more than the
 * roster beside them. A non-object answers `undefined` — "no last result", which is the
 * normal case for every connect outside the 120 s window after a finish.
 */
export const asLastResult = (value: unknown): LastResult | undefined => {
  if (!value || typeof value !== 'object') return undefined;
  const r = value as Record<string, unknown>;
  return {
    lobbyId: asTag(r.lobbyId),
    finishedAt: asNum(r.finishedAt),
    winnerId: asTag(r.winnerId),
    totalRounds: asNum(r.totalRounds),
    rewards: asRewards(r.rewards),
    rewardTable: asRewardTable(r.rewardTable),
    // same rule as asPlayers: a non-array roster is "no roster", never a crash — but here
    // the absence must stay visible, so there is no fallback array to hide it behind
    roster: Array.isArray(r.roster) ? (r.roster as LobbyPlayer[]) : undefined,
  };
};
