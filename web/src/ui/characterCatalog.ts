// Ground truth about characters, copied out of main-server: which ids exist, what kind of player
// each one is meant for, and which categories the game itself gives them.
//
// A data module on purpose. It is the longest thing in the editor and the thing that goes stale
// first (main-server gains a character, a category is renamed), so it is kept where it can be
// re-checked against the server in one sitting, without reading a line of JSX.
//
// Everything here was read out of main-server on branch SurvivalMode (2026-08-05); the file/line
// is named at each claim so the next reader can re-check instead of trusting a comment.

import { CHARACTER_COUNT } from '../gameAssets';

/**
 * `api.beGenius.orderCategories` — lib/other.js:29. resetChar refuses anything outside this list,
 * and it does so through `api.beGenius.error.commonError` (lib/characters.js:331), which is a typo
 * for `errors` and therefore THROWS instead of answering. A bad category payload gets no readable
 * refusal at all, which is why this editor validates the selection itself before it calls.
 */
export const CATEGORIES = [
  { id: 'history', label: 'Історія' },
  { id: 'geography', label: 'Географія' },
  { id: 'art', label: 'Мистецтво' },
  { id: 'sport', label: 'Спорт' },
  { id: 'science', label: 'Наука' },
];

export type CharacterKind = 'basic' | 'reborn' | 'premium';

/**
 * Which of the 29 characters resetChar will accept, and the strong categories the GAME gives each
 * one. Transcribed from main-server/applications/beGenius/lib/characters.js (basicCharacters /
 * rebornCharacters / premiumCharacters, read 2026-08-05) — the type drives the "will the server
 * take it?" verdict, the categories preload the picker.
 *
 * Premium entries carry no strongCategories in the server table at all (they are sold on a
 * bonusSkill instead), so they preload nothing and the tester picks freely.
 */
export const CHARACTER_META: Record<number, { kind: CharacterKind; strong: string[] }> = {
  0: { kind: 'basic', strong: ['history', 'geography'] }, // Darwin
  1: { kind: 'basic', strong: ['history', 'art'] }, // Churchill
  2: { kind: 'basic', strong: ['history', 'sport'] }, // Coubertin
  3: { kind: 'basic', strong: ['history', 'science'] }, // Franklin
  4: { kind: 'basic', strong: ['geography', 'art'] }, // Verne
  5: { kind: 'basic', strong: ['geography', 'sport'] }, // Grylls
  6: { kind: 'basic', strong: ['geography', 'science'] }, // Galilei
  7: { kind: 'basic', strong: ['art', 'sport'] }, // Lee
  8: { kind: 'basic', strong: ['art', 'science'] }, // Einstein
  9: { kind: 'basic', strong: ['sport', 'science'] }, // Bohr
  10: { kind: 'basic', strong: ['history'] }, // Victoria
  11: { kind: 'basic', strong: ['geography'] }, // Earhart
  12: { kind: 'basic', strong: ['art'] }, // Hepburn
  13: { kind: 'basic', strong: ['sport'] }, // Serena
  14: { kind: 'basic', strong: ['science'] }, // Curie
  15: { kind: 'reborn', strong: ['history'] }, // Napoleon
  16: { kind: 'reborn', strong: ['geography'] }, // Columbus
  17: { kind: 'reborn', strong: ['art'] }, // Dali
  18: { kind: 'reborn', strong: ['sport'] }, // Ali
  19: { kind: 'reborn', strong: ['science'] }, // Tesla
  20: { kind: 'reborn', strong: ['history'] }, // Cleopatra
  21: { kind: 'reborn', strong: ['geography'] }, // Wanda
  22: { kind: 'reborn', strong: ['art'] }, // Monroe
  23: { kind: 'reborn', strong: ['sport'] }, // Sonja
  24: { kind: 'reborn', strong: ['science'] }, // Ada
  25: { kind: 'premium', strong: [] }, // Nietzsche
  26: { kind: 'premium', strong: [] }, // Hemingway
  27: { kind: 'premium', strong: [] }, // Carroll
  28: { kind: 'premium', strong: [] }, // Rowling
};

// Private: the only thing this table is for is building GALLERY below, and a second consumer
// would have to decide what to do about the 'other' bucket, which only makes sense there.
const KIND_GROUPS: { kind: CharacterKind | 'other'; label: string; note: string }[] = [
  { kind: 'basic', label: 'Базові', note: 'гравець БЕЗ реборну — те, чим є тестовий акаунт' },
  { kind: 'reborn', label: 'Реборн', note: 'тільки гравцеві, що пройшов реборн' },
  { kind: 'premium', label: 'Преміум', note: 'за задумом потрібні в boughtCharacters' },
  { kind: 'other', label: 'Без типу', note: 'є в gameAssets, але не в таблиці типів' },
];

/**
 * The gallery is driven by CHARACTER_COUNT, not by CHARACTER_META's own length: if the game ever
 * gains a character and only gameAssets.ts is updated, it still shows up here — in the «Без типу»
 * group, which is exactly the state worth seeing, instead of silently vanishing from the picker.
 */
export const GALLERY = (() => {
  const buckets: Record<string, number[]> = { basic: [], reborn: [], premium: [], other: [] };
  for (let id = 0; id < CHARACTER_COUNT; id++) buckets[CHARACTER_META[id]?.kind ?? 'other'].push(id);
  return KIND_GROUPS.map((g) => ({ ...g, ids: buckets[g.kind] })).filter((g) => g.ids.length > 0);
})();
