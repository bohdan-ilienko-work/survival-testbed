// ─── entering a match, and leaving the last one behind ────────────────────────
//
// What belongs to a MATCH rather than to the player, and the one function that drops it when
// this tab moves to another lobby. The wallet's twin (see NO_OFFER in wallet.ts): one named
// reset, so no caller has to remember the list of fields by hand.
//
// It exists because the testbed lives ACROSS matches. One tab plays lobby A to the end, then
// clicks «Зайти в Survival» again and lands in lobby B. Nothing in the join path used to clear
// the round-scoped half of the state, so B's «чекаємо на гравців» screen was labelled with A's
// last round and A's last mode — «1. Лобі · раунд 7 · CHRONO» over a lobby that has not dealt a
// single question. Worse, `iAmEliminated` survived too, so a player who went out in A was put
// into the spectator step by B's very first `roundStarted`.

import type { SurvivalState } from './state';

/**
 * Every field a MATCH fills, back to its empty value.
 *
 * The wallet fields are deliberately NOT here: tickets live on main-server and belong to the
 * player, not to the lobby that just ended. Neither is `players` — the join reply and the roster
 * broadcasts overwrite it on their own, and blanking it here would empty the column for a beat.
 */
export const NO_MATCH = {
  round: 0,
  mode: undefined,
  question: undefined,
  deadline: undefined,
  nextRoundAt: undefined,
  myAnswer: undefined,
  answeredCount: 0,
  scores: [],
  correctAnswer: undefined,
  roundDelta: undefined,
  eliminated: [],
  iAmEliminated: false,
  buybackOpen: false,
  lastBuyBack: undefined,
  tiebreak: undefined,
  winnerId: undefined,
  totalRounds: undefined,
  rewards: undefined,
  rewardTable: undefined,
} satisfies Partial<SurvivalState>;

/**
 * Adopt a lobby id.
 *
 * A DIFFERENT lobby means everything above is stale, and the step goes back to 'lobby' with it:
 * a tab that reached 'finished' in the previous match would otherwise keep the old final board
 * on screen while the new lobby fills up beside it in the roster column.
 *
 * The two "do nothing" arms are as load-bearing as the reset. An unreadable id says nothing
 * about which lobby this is, and NO id held yet is a fresh state that has nothing to lose —
 * treating either as a change would blank the snapshot the very same reply is delivering.
 */
export function enterLobby(state: SurvivalState, lobbyId: unknown): SurvivalState {
  if (typeof lobbyId !== 'string' || lobbyId === '') return state;
  if (state.lobbyId === undefined || state.lobbyId === lobbyId) return state;
  return { ...state, ...NO_MATCH, step: 'lobby', lobbyId };
}
