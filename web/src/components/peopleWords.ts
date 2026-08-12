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
