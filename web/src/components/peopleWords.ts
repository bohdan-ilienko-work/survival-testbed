// «2 гравці + 5 ботів» — the humans/bots split every headline counter shows.
//
// One formatter for the three places that count people (Stage's lobby panel, the aside's
// roster heading, the booking headline): under C2 bots are seeded the moment the lobby opens,
// so any bare total is dominated by bots from the first broadcast — a counter that does not
// split is a counter that reads «7 гравців» about two humans.

import { countHumans, type LobbyPlayer } from '../survival';

/** 1 гравець · 2 гравці · 5 гравців — the count sits in a headline, so it has to agree. */
const counted = (n: number, one: string, few: string, many: string): string => {
  const tens = n % 100;
  const ones = n % 10;
  if (ones === 1 && tens !== 11) return one;
  if (ones >= 2 && ones <= 4 && (tens < 12 || tens > 14)) return few;
  return many;
};

export const playersWord = (n: number): string => counted(n, 'гравець', 'гравці', 'гравців');
export const botsWord = (n: number): string => counted(n, 'бот', 'боти', 'ботів');

/**
 * «X гравців + Y ботів» for a roster.
 *
 * `total` is passed separately because the booking reply carries the server's own playerCount,
 * which may run ahead of the roster rows we hold — the surplus is counted as bots (a human we
 * cannot see is indistinguishable from one, and the human number must never be inflated), and
 * the clamp keeps a stale roster from producing a negative bot count.
 */
export function humansBotsLabel(total: number, players: LobbyPlayer[]): string {
  const humans = Math.min(countHumans(players), total);
  const bots = Math.max(0, total - humans);
  return `${humans} ${playersWord(humans)} + ${bots} ${botsWord(bots)}`;
}

/**
 * «залишилось 5 гравців» — how many are still in the fight, in words rather than as a bare
 * number.
 *
 * A digit on its own is ambiguous on every screen that shows one: «5/12» beside a roster reads
 * as a score, a slot, a page. The words say which of the two numbers is the live one — and this
 * IS the number a survival match is about, since the whole mode is people leaving it.
 *
 * The verb is inflected with the noun, because Ukrainian will not let one agree without the
 * other: «залишився 1 гравець», «залишилось 2 гравці», «залишилось 5 гравців». 11 takes the
 * many-form («залишилось 11 гравців») exactly as `counted` above already handles for the noun.
 */
export function playersLeftLabel(n: number): string {
  const tens = n % 100;
  const verb = n % 10 === 1 && tens !== 11 ? 'залишився' : 'залишилось';
  return `${verb} ${n} ${playersWord(n)}`;
}
