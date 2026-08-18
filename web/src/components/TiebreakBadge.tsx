// «ТАЙБРЕЙК · усі помилились · 2/5» — the one thing on screen that says this is not a round.
//
// A sudden death consumes no round number, emits no `roundStarted` and does not count against
// the round cap, so nothing else in the stepbar changes when one starts: the round number stays
// put and a new question simply appears. This badge is the whole difference, which is why the
// player's stage and the watch screen draw the SAME component — two renderings of one marker
// are two things free to disagree, and telling them apart at a glance is the point.

import { tiebreakLabel, type TiebreakInfo } from '../survival';

/**
 * @param now the clock the caller is already correcting — the player's own `now`, and the
 * SERVER's (now + skew) on the watch screen. `startsAt` is an absolute server instant, so a
 * badge that subtracted the raw browser clock would count the reveal down by the skew.
 */
export function TiebreakBadge({ tiebreak, now }: { tiebreak?: TiebreakInfo; now: number }) {
  if (!tiebreak) return null;

  // Only the reveal has anything to count: once a decider is open its own answer deadline is
  // the timer in the corner, and once it is settled there is nothing coming at all.
  const revealLeft =
    tiebreak.phase === 'pending' && tiebreak.startsAt !== undefined
      ? Math.max(0, Math.ceil((tiebreak.startsAt - now) / 1000))
      : null;

  return (
    <span
      className={`tiebreak ${tiebreak.phase}`}
      // The cohort is the evidence: on an all-wrong round it is the whole lobby, on a boundary
      // tie it is the two players who could not be separated, and that difference is invisible
      // from the badge text alone.
      title={
        tiebreak.playerIds.length > 0
          ? `грають: ${tiebreak.playerIds.join(', ')}`
          : 'сервер не назвав, хто саме грає тайбрейк'
      }
    >
      {tiebreakLabel(tiebreak)}
      {revealLeft !== null && ` · питання через ${revealLeft} с`}
      {tiebreak.phase === 'done' && ' · зіграно'}
    </span>
  );
}
