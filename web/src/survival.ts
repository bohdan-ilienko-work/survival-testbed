// Survival mode client state, driven by the events the server actually emits
// (names taken from the code, not the flowchart).
//
// The implementation lives in ./survival/*; this file stays the one import path the app uses and
// re-exports the same surface it always had, so splitting the code never touches a consumer.
//
//   wire.ts     — the payload types (leaf: imports nothing)
//   state.ts    — SurvivalState, its empty value and the label per step
//   guards.ts   — one guard per shape, so nothing off the wire is trusted
//   reasons.ts  — machine reason tags → the Ukrainian text the player reads
//   wallet.ts   — the per-player BuyBack offer and the ticket balance
//   booking.ts  — the RPC replies the booking screen polls
//   reduce.ts   — the event dispatcher, split by family into reduceLobby / Round / Buyback

export type {
  LastResult,
  LobbyPlayer,
  Question,
  RankReward,
  RewardRow,
  RoundMode,
  Score,
} from './survival/wire';
export type { Step, SurvivalState } from './survival/state';
export { countHumans, initialState, stepLabel } from './survival/state';
// the one guard a component needs of its own: the results table reads each player's miss
// straight off the score line, which is as untrusted as anything else off the wire
export { asLastResult, asMiss } from './survival/guards';
export {
  LOBBY_ENDED_TEXT,
  MATCH_IN_PROGRESS_TEXT,
  errorText,
  isLobbyEnded,
  reasonText,
  reasonWithTag,
} from './survival/reasons';
export { applyBuyBackQuote, applyTicketBalance } from './survival/wallet';
export type { BookingLobby, BookingStatus } from './survival/booking';
export {
  applyConnectReply,
  readBookingStatus,
  readOnboardingClosesAt,
} from './survival/booking';
export { reduce } from './survival/reduce';
