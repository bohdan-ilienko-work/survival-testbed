// ─── the tiebreak block of a spectator snapshot ───────────────────────────────
//
// A watcher who arrives DURING a sudden death gets no events for it — the reveal and the
// decider's start are already spent — so the snapshot's own `fight.tiebreak` block is the only
// thing that can tell it what it walked into. Without it the watch screen shows a bare question
// (or, during the reveal, a results board) with nothing saying the round is being re-decided.
//
// Its own module for a physical reason as much as a tidy one: spectator.ts and spectatorFeed.ts
// are both at the 200-line budget, and this reads the RAW reply anyway — the same object both of
// them are built from — so it needs nothing either of them holds.

import { asNum } from './guards';
import type { SpectatorFeed } from './spectatorFeed';
import { readTiebreak } from './tiebreak';
import type { TiebreakInfo } from './wire';

const objOf = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : {};

/**
 * Read `reply.fight.tiebreak`, or `undefined` when no sudden death is running.
 *
 * The phase is DERIVED, because a snapshot is a still frame and carries no event name — and it
 * is derived from `startsAt`, the one field that actually carries the distinction: the server
 * documents it as the instant the decider's answers OPEN while they are not open yet, and null
 * once they are, which is the same invariant `tiebreakStarted` carries on the live path.
 *
 * NOT from `iteration`. That field is never absent — the reveal ships it as 0 — so reading it
 * put every watcher in 'active', which both printed «0/5» for a decider round that had not been
 * asked and dropped the «питання через N с» countdown, the only timer the reveal window has.
 */
export function readSnapshotTiebreak(reply: unknown): TiebreakInfo | undefined {
  const raw = objOf(objOf(reply).fight).tiebreak;
  if (!raw || typeof raw !== 'object') return undefined;
  const p = raw as Record<string, unknown>;
  // The snapshot writes iteration 0 for "no decider has been asked yet", where the live events
  // simply omit the field. Translated here, at the one place the two spellings meet, so the
  // marker never holds a decider number the badge would print as «0/5».
  const iteration = asNum(p.iteration);
  const block = iteration !== undefined && iteration < 1 ? { ...p, iteration: undefined } : p;
  return readTiebreak(block, asNum(p.startsAt) === undefined ? 'active' : 'pending');
}

/**
 * Fold that block into a freshly adopted feed.
 *
 * Applied after `applySpectatorSnapshot` rather than inside it: that function is a full REPLACE
 * built from `initialState` (a lobby rotation must not inherit the previous match), so anything
 * it does not know about is blanked — which is exactly the right default and exactly why this
 * has to be the last write rather than a field it could forget.
 */
export function withSnapshotTiebreak(feed: SpectatorFeed, reply: unknown): SpectatorFeed {
  const tiebreak = readSnapshotTiebreak(reply);
  if (tiebreak === undefined) return feed;
  return { ...feed, state: { ...feed.state, tiebreak } };
}
