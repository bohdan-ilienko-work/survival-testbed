// Who answered WHAT, while the round is still open.
//
// The server sends this only to a player who has already answered — a private `answersRevealed`,
// never a broadcast — so the board can only ever fill for someone whose own answer is already
// committed and unchangeable. The client keeps that shape honest: the list is per ROUND, it is
// merged by playerId (the same player can only ever hold one line), and it is emptied by
// `roundStarted` like every other per-round field.
//
// Its own module because it is two jobs the reducer should not grow: taking the rows off the
// wire safely, and turning a raw answer value into the one line a person reads.

import { asNum, asTag } from './guards';
import type { LiveAnswer, Question } from './wire';

/** One row off the wire, or null when it is not a usable answer line. */
function readAnswer(raw: any): LiveAnswer | null {
  const playerId = asTag(raw?.playerId);
  if (!playerId) return null;
  return {
    playerId,
    name: typeof raw.name === 'string' ? raw.name : '',
    value: raw.value,
    elapsedMs: asNum(raw.elapsedMs) ?? 0,
  };
}

/**
 * Folds an `answersRevealed` payload into the board.
 *
 * The two payload shapes are one shape on purpose: the submitter is sent the whole board so far
 * and everyone earlier is sent the single new line, so both are «merge these rows by playerId».
 * Order is kept by arrival — that is the order the answers actually landed in, which is exactly
 * what makes the board readable while the clock runs.
 */
export function mergeLiveAnswers(current: LiveAnswer[], raw: unknown): LiveAnswer[] {
  const incoming = Array.isArray(raw) ? raw.map(readAnswer).filter(Boolean) as LiveAnswer[] : [];
  if (incoming.length === 0) return current;

  const merged = [...current];
  for (const answer of incoming) {
    const at = merged.findIndex((line) => line.playerId === answer.playerId);
    if (at === -1) merged.push(answer);
    else merged[at] = answer;
  }
  return merged;
}

/** The answer as one short line: what this player actually sent, in this round's own terms. */
export function describeAnswer(value: unknown, question?: Question): string {
  const v = value as any;
  if (!v || typeof v !== 'object') return '—';

  if (v.type === 'selection') {
    const option = (question?.options ?? []).find((o) => o.id === v.optionId);
    return option ? option.text : `варіант ${v.optionId}`;
  }
  if (v.type === 'number') return String(v.value);
  if (v.type === 'map') {
    const lat = Number(v.lat);
    const lng = Number(v.lng);
    return Number.isFinite(lat) && Number.isFinite(lng)
      ? `${lat.toFixed(2)}, ${lng.toFixed(2)}`
      : '—';
  }
  if (v.type === 'chrono') {
    const years = question?.years ?? [];
    const pairs: number[] = Array.isArray(v.pairs) ? v.pairs : [];
    // Read in the events' order: «подія → рік», with an unpaired event left blank rather than
    // printed as the -1 the wire carries.
    return pairs
      .map((yearIndex, i) => `${i + 1}→${years[yearIndex] ?? '—'}`)
      .join('  ') || '—';
  }
  return '—';
}
