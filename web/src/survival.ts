// Survival mode client state, driven by the events the server actually emits
// (names taken from the code, not the flowchart).
//
// The implementation lives in ./survival/*; this file stays the one import path the app uses and
// re-exports the same surface it always had, so splitting the code never touches a consumer.
//
//   wire.ts     — the payload types (leaf: imports nothing)
//   state.ts    — SurvivalState, its empty value and the label per step
//   match.ts    — what a MATCH fills, and the reset that runs when this tab changes lobby
//   guards.ts   — one guard per shape, so nothing off the wire is trusted
//   reasons.ts  — machine reason tags → the Ukrainian text the player reads
//   wallet.ts   — the per-player BuyBack offer and the ticket balance
//   booking.ts  — the RPC replies the booking screen polls
//   tiebreak.ts — the sudden-death marker: one reader for its three events, one set of words
//   spectator.ts     — the watcher's one reply shape, guarded
//   spectatorFeed.ts — that snapshot plus the live stream, as a SurvivalState of its own
//   reduce.ts   — the event dispatcher, split by family into reduceLobby / Round / Buyback

export type {
  LastResult,
  LobbyPlayer,
  Question,
  QuestionImage,
  RankReward,
  RewardRow,
  RoundMode,
  Score,
  TiebreakInfo,
  TiebreakReason,
} from './survival/wire';
export type { Step, SurvivalState } from './survival/state';
export { countHumans, initialState, stepLabel } from './survival/state';
// entering a match, and dropping the one before it — see the note on NO_MATCH
export { NO_MATCH, enterLobby } from './survival/match';
// the sudden-death marker: its reader is the reducer's, its words are every panel's
export {
  isTiebreakSpectator,
  tiebreakLabel,
  tiebreakReasonText,
} from './survival/tiebreak';
// the one guard a component needs of its own: the results table reads each player's miss
// straight off the score line, which is as untrusted as anything else off the wire
export { asImage, asLastResult, asMiss, asUrl } from './survival/guards';
export {
  LOBBY_ENDED_TEXT,
  MATCH_IN_PROGRESS_TEXT,
  errorText,
  isLobbyEnded,
  reasonText,
  reasonWithTag,
} from './survival/reasons';
export { applyBuyBackQuote, applyTicketBalance } from './survival/wallet';
export type { BookingLobby, BookingStatus } from './survival/bookingTypes';
export {
  applyConnectReply,
  readBookingStatus,
  readOnboardingClosesAt,
} from './survival/booking';
export { reduce } from './survival/reduce';
export type {
  SpectatorFight,
  SpectatorLobby,
  SpectatorRound,
  SpectatorSnapshot,
} from './survival/spectator';
export { readSpectatorSnapshot } from './survival/spectator';
export type { SpectatorFeed } from './survival/spectatorFeed';
export {
  applySpectatorSnapshot,
  emptySpectatorFeed,
  lastResultBoard,
  reduceSpectator,
} from './survival/spectatorFeed';
export { withSnapshotTiebreak } from './survival/spectatorTiebreak';
