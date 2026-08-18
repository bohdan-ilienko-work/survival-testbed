// ─── the sudden-death marker ──────────────────────────────────────────────────
//
// A tiebreak is NOT a normal round — no round number is consumed, no `roundStarted` is emitted,
// the round cap is not touched — and until now the only thing that said so on the wire was a
// question arriving out of nowhere. This module is the one reader of the three events that
// describe it and the one place their Ukrainian words are built.
//
// It MERGES rather than replaces, because the three events know different halves of the same
// fact: `tiebreakPending` carries the reason and the instant the decider opens, `tiebreakStarted`
// carries the iteration and the decider's mode, `roundResult` carries only the reason. A reader
// that overwrote would blank the iteration on the last event of the sequence.

import { asIds, asNum, asTag } from './guards';
import type { RoundMode, TiebreakInfo, TiebreakReason } from './wire';

/** Every reason the client has words for. Anything else is «сервер не сказав», never a crash. */
const REASONS: readonly string[] = ['all_wrong', 'boundary_tie'];

export const asTiebreakReason = (value: unknown): TiebreakReason | undefined => {
  const tag = asTag(value);
  return tag !== undefined && REASONS.includes(tag) ? (tag as TiebreakReason) : undefined;
};

/**
 * Read one tiebreak event into the marker, folded onto what we already hold.
 *
 * `phase` is stated by the CALLER and never read off the wire: it is which EVENT arrived, and
 * the event name is the only thing that can say whether answers are open right now. A payload
 * field would be one more thing that can disagree with the state machine it describes.
 */
export function readTiebreak(
  p: any,
  phase: TiebreakInfo['phase'],
  held?: TiebreakInfo,
): TiebreakInfo {
  const ids = asIds(p?.playerIds);
  return {
    phase,
    reason: asTiebreakReason(p?.reason) ?? held?.reason,
    iteration: asNum(p?.iteration) ?? held?.iteration,
    maxIterations: asNum(p?.maxIterations) ?? held?.maxIterations,
    // an empty list is "the server did not say who", so the cohort we already knew survives it
    playerIds: ids.length > 0 ? ids : held?.playerIds ?? [],
    startsAt: asNum(p?.startsAt) ?? held?.startsAt,
    mode: (asTag(p?.mode) as RoundMode | undefined) ?? held?.mode,
  };
}

/**
 * `roundResult` closing a round that was decided by sudden death.
 *
 * It is the LAST word and the only one an older server sends at all (`tiebreakPlayerIds` with no
 * reason), so it may only ever ADD to the marker. Returning `held` unchanged when the payload
 * mentions no tiebreak is deliberate: the decider demonstrably ran, and clearing the badge on
 * the very event the results screen is drawn from would erase the explanation at the moment the
 * player finally has time to read it.
 */
export function mergeRoundResultTiebreak(held: TiebreakInfo | undefined, p: any): TiebreakInfo | undefined {
  const reason = asTiebreakReason(p?.tiebreakReason);
  const ids = asIds(p?.tiebreakPlayerIds);
  if (reason === undefined && ids.length === 0) return held;
  return {
    ...(held ?? { playerIds: [], phase: 'done' as const }),
    phase: 'done',
    reason: reason ?? held?.reason,
    playerIds: ids.length > 0 ? ids : held?.playerIds ?? [],
  };
}

/** The cause, in the words the tester reads. An unknown tag says so instead of going blank. */
export const tiebreakReasonText = (reason?: TiebreakReason): string =>
  reason === 'all_wrong'
    ? 'усі помилились'
    : reason === 'boundary_tie'
      ? 'нічия на межі'
      : 'причину сервер не назвав';

/** «ТАЙБРЕЙК · усі помилились · 2/5» — the badge, short enough to sit in the stepbar. */
export function tiebreakLabel(tb: TiebreakInfo): string {
  const parts = ['ТАЙБРЕЙК', tiebreakReasonText(tb.reason)];
  // The iteration only exists once a decider is actually open; during the reveal there is none,
  // and printing «0/5» there would claim a round that has not been asked.
  if (tb.iteration !== undefined) {
    parts.push(tb.maxIterations === undefined ? `${tb.iteration}` : `${tb.iteration}/${tb.maxIterations}`);
  }
  return parts.join(' · ');
}

/**
 * Am I locked out of the decider on screen?
 *
 * A tiebreak is contested by a NAMED cohort, and every other live player is shown the same
 * question with nothing to win. The server is being taught to refuse their answers; the panel
 * has to stop offering to send one, or a tester outside the cohort reads a silent refusal as a
 * broken submit. No cohort (an older server) means nobody is locked out.
 */
export const isTiebreakSpectator = (tb?: TiebreakInfo, playerId?: string): boolean =>
  tb?.phase === 'active' &&
  tb.playerIds.length > 0 &&
  playerId !== undefined &&
  !tb.playerIds.includes(playerId);
