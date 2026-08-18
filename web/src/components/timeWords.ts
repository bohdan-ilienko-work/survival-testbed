// «через 3 год 12 хв» — how far away an absolute instant is, in words.
//
// One formatter for the two screens that answer «коли починається»: the booking dialog, which
// is opened hours before the match, and the watch screen, which answers the same question for
// somebody who never registered. Both are handed an ABSOLUTE epoch ms and subtract the shared
// clock themselves — this only turns the difference into a sentence.
//
// Split out of BookingBody when the watch screen needed the same words: a second copy would
// have been a second set of thresholds, and «через 0 хв 59 с» in one panel beside «через 1 хв»
// in another is exactly the kind of disagreement a testbed is supposed to expose, not produce.

/**
 * @param ms how far ahead the instant is; ≤0 means it has already passed, which is said out
 * loud rather than counted backwards — a match whose start is behind us is not «через -4 хв».
 * Seconds are noise while hours are left, so they only appear under the hour.
 */
export const untilText = (ms: number): string => {
  if (!Number.isFinite(ms)) return '';
  if (ms <= 0) return 'старт уже настав';
  const total = Math.round(ms / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (hours > 0) return `через ${hours} год ${minutes} хв`;
  if (minutes > 0) return `через ${minutes} хв ${total % 60} с`;
  return `через ${total} с`;
};
