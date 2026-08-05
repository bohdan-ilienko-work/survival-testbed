// How the endgame table is RANKED — the arithmetic only, with no markup anywhere near it.
//
// It is worth its own module because it is the one place on this screen where the client invents
// data the server did not send, and every such invention has to be marked as one.

import type { LobbyPlayer, RewardRow } from '../survival';

/** One line of the endgame table: a roster row joined with its payout, if it got one. */
export interface FinishRow {
  playerId: string;
  /** the OVERALL final rank (bots consume ranks too) */
  rank?: number;
  /** true = the rank was reconstructed client-side, not stated by the server */
  approx: boolean;
  name?: string;
  flag?: string;
  character?: number;
  isBot?: boolean;
  eliminated?: boolean;
  eliminatedAtRound?: number | null;
  gems: number;
  tickets: number;
}

/**
 * Join the final roster with the payout rows into one ranked table.
 *
 * The wire states ranks only for PAID humans — bots consume ranks but are omitted, and so are
 * all-zero rows — so most bots (and humans below the paid ranks) arrive rankless. Rather than
 * dropping them, the unclaimed ranks are handed out from what the client watched happen: the
 * winner first, then survivors, then the later-eliminated over the earlier. Every such rank is
 * MARKED as reconstructed — a testbed must never pass a client guess off as a server fact.
 */
export function buildFinishRows(
  players: LobbyPlayer[],
  rewards: RewardRow[] | undefined,
  winnerId?: string | null,
): FinishRow[] {
  // first payout row per player wins; a duplicate playerId in `rewards` is a server bug the
  // raw event log already shows, and doubling money on screen would compound it
  const paid = new Map<string, RewardRow>();
  for (const r of rewards ?? []) if (!paid.has(r.playerId)) paid.set(r.playerId, r);

  const rows: FinishRow[] = players.map((p) => {
    const r = paid.get(p.playerId);
    return {
      playerId: p.playerId,
      rank: r?.rank,
      approx: false,
      name: p.name,
      flag: p.flag,
      character: p.character,
      isBot: p.isBot,
      eliminated: p.eliminated,
      eliminatedAtRound: p.eliminatedAtRound,
      gems: r?.gems ?? 0,
      tickets: r?.tickets ?? 0,
    };
  });

  // a payout addressed to somebody the roster forgot still has to be visible — it is money
  const known = new Set(rows.map((row) => row.playerId));
  for (const r of paid.values()) {
    if (known.has(r.playerId)) continue;
    known.add(r.playerId);
    rows.push({
      playerId: r.playerId,
      rank: r.rank,
      approx: false,
      gems: r.gems ?? 0,
      tickets: r.tickets ?? 0,
    });
  }

  // the ranks the server did not claim, in order — these go to the rankless rows below
  const taken = new Set<number>();
  for (const row of rows) if (row.rank !== undefined) taken.add(row.rank);
  const free: number[] = [];
  for (let n = 1; n <= rows.length; n++) if (!taken.has(n)) free.push(n);

  // roster order is the final tiebreak, so two bots eliminated in one round stay stable
  const order = new Map(rows.map((row, i) => [row, i] as [FinishRow, number]));
  const outcome = (row: FinishRow): number => {
    if (winnerId && row.playerId === winnerId) return Number.MAX_SAFE_INTEGER;
    if (!row.eliminated) return Number.MAX_SAFE_INTEGER - 1; // survived to the final round
    // later elimination = better place; an unknown round sorts below every known one
    return typeof row.eliminatedAtRound === 'number' ? row.eliminatedAtRound : -1;
  };
  const unranked = rows
    .filter((row) => row.rank === undefined)
    .sort((a, b) => outcome(b) - outcome(a) || order.get(a)! - order.get(b)!);
  unranked.forEach((row, i) => {
    // more rankless players than free ranks (duplicate server ranks): '—' beats a wrong number
    if (free[i] === undefined) return;
    row.rank = free[i];
    row.approx = true;
  });

  return rows.sort(
    (a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity) || order.get(a)! - order.get(b)!,
  );
}
