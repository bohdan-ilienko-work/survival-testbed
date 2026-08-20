// ─── the RPC replies (beG.getSurvivalStatus, survival.connect) ────────────────
//
// The replies the UI has to ASK for rather than receive as events, and the types that describe
// them. Their own file because they are not part of the event stream at all: the booking popup
// is shown hours before the match, when there is no survival session to listen on, and the
// connect reply is the one message a freshly bound socket gets about broadcasts it missed.

import { asBool, asLastResult, asNum, asPlayers, asTag } from './guards';
import type { BookingLobby, BookingStatus } from './bookingTypes';
import { initialState, type SurvivalState } from './state';
import { NO_OFFER } from './wallet';

/**
 * Read a beG.getSurvivalStatus reply.
 *
 * Same discipline as asPlayers above and for the same reason: this panel renders for a player
 * who has joined nothing, so a missing or renamed field has to degrade into "the server did not
 * say" instead of throwing inside a render. `lobby: null` (nothing is being booked yet) is a
 * legitimate answer and is deliberately kept distinct from `available: false` (survival-server
 * did not answer at all) — the two need different words on screen.
 */
export function readBookingStatus(reply: unknown): BookingStatus {
  const r: any = reply && typeof reply === 'object' ? reply : {};
  const raw = r.lobby;
  const lobby: BookingLobby | null =
    raw && typeof raw === 'object'
      ? {
          // asTag is "a non-empty string or nothing", which is exactly what an id, a state
          // name and an ISO timestamp are here
          lobbyId: asTag(raw.lobbyId),
          state: asTag(raw.state),
          playerCount: asNum(raw.playerCount),
          activePlayerCount: asNum(raw.activePlayerCount),
          scheduledStartAt: asTag(raw.scheduledStartAt),
          eventNo: asNum(raw.eventNo),
          eventsTotal: asNum(raw.eventsTotal),
          round: asNum(raw.round),
          // no lobby means no roster, and an empty roster is not the same as "not an array"
          roster: asPlayers(raw.roster, []),
        }
      : null;

  return {
    available: asBool(r.available),
    registered: asBool(r.registered),
    joinable: asBool(r.joinable),
    lobby,
    tickets: asNum(r.tickets),
    entryCost: asNum(r.entryCost),
    freeDailyTickets: asNum(r.freeDailyTickets),
    freeDailyGranted: asNum(r.freeDailyGranted),
    nextFreeDailyAt: asTag(r.nextFreeDailyAt),
    fetchedAt: Date.now(),
  };
}

/**
 * `onboardingClosesAt` off a survival.connect / survival.getLobbyStatus reply.
 *
 * THIS is the field that fixes the missing countdown: `onboardingStarted` is a one-shot
 * broadcast, so a tab that binds (or re-binds) after the window opened never receives it and had
 * nothing but the raw scheduled start to show. Both replies carry the deadline instead, so such a
 * tab can draw the countdown the moment it joins.
 *
 * Three answers, all of which have to stay distinct:
 *   number    — the absolute deadline; adopt it
 *   null      — the server says this lobby is NOT on-boarding; a deadline we still hold is stale
 *   undefined — the reply has no such field (an older survival-server); keep whatever we have
 *
 * A present-but-unreadable value degrades to `undefined` for the same reason asNum exists: a
 * NaN deadline would render as «старт через NaN с» instead of falling back to the scheduled time.
 */
export function readOnboardingClosesAt(reply: unknown): number | null | undefined {
  if (!reply || typeof reply !== 'object') return undefined;
  const r = reply as Record<string, unknown>;
  if (!('onboardingClosesAt' in r)) return undefined;
  return r.onboardingClosesAt === null ? null : asNum(r.onboardingClosesAt);
}

/**
 * Apply a survival.connect reply — the ONE reader for every shape it can take, so no hook
 * merges its fields by hand (`?? st.X` fallbacks were exactly how a reply without a lobby
 * left the previous, finished lobby standing on screen).
 *
 * `lastResult` (C3) wins over everything else — EXCEPT `reconnected:true`. The server attaches
 * it independently of the current binding, so a player mid-fight in lobby B can reconnect with
 * B's live fight AND A's fresh finish in one reply; the fight to resume outranks the board of
 * a match that is over. Applied lastResult maps onto the SAME fields 'lobbyFinished' fills —
 * including step 'finished', which arms the endgame balance re-read.
 * Otherwise `lobbyId` is read three-way, same discipline as readOnboardingClosesAt above:
 *   string    — a LIVE lobby: adopt its snapshot; the step is only promoted out of 'idle',
 *               never demoted — a mid-fight step belongs to the round events that follow
 *   null      — the server EXPLICITLY says no lobby exists: everything lobby-scoped we hold
 *               is stale, so clear it and land on 'idle'
 *   undefined — the reply does not say (older build / error shape): keep what we have
 */
export function applyConnectReply(state: SurvivalState, reply: unknown): SurvivalState {
  const r: any = reply && typeof reply === 'object' ? reply : {};

  const last = asLastResult(r.lastResult);
  if (last && r.reconnected !== true) {
    return {
      ...state,
      ...NO_OFFER,
      buybackOpen: false,
      step: 'finished',
      lobbyId: last.lobbyId ?? state.lobbyId,
      lobbyState: 'FINISHED',
      players: last.roster ?? state.players,
      winnerId: last.winnerId ?? null,
      totalRounds: last.totalRounds ?? state.totalRounds,
      rewards: last.rewards ?? state.rewards,
      rewardTable: last.rewardTable ?? state.rewardTable,
      // nothing is on-boarding and no round is coming — any of these instants would put a
      // live countdown on the finish screen
      onboardingEndsAt: undefined,
      deadline: undefined,
      nextRoundAt: undefined,
    };
  }

  if ('lobbyId' in r && r.lobbyId === null) {
    // the explicit "no lobby": back to the empty state, keeping only what belongs to the
    // PLAYER (tickets live on main-server, not in the gone lobby) and the error line
    return {
      ...initialState,
      tickets: state.tickets,
      ticketsDelta: state.ticketsDelta,
      ticketsReason: state.ticketsReason,
      lastError: state.lastError,
    };
  }

  const lobbyId = asTag(r.lobbyId);
  if (lobbyId === undefined) return state;

  const closesAt = readOnboardingClosesAt(r);
  return {
    ...state,
    step: state.step === 'idle' ? 'lobby' : state.step,
    lobbyId,
    lobbyState: asTag(r.state) ?? state.lobbyState,
    scheduledStartAt: asTag(r.scheduledStartAt) ?? state.scheduledStartAt,
    players: asPlayers(r.roster, state.players),
    // undefined = the server said nothing (old build) → keep ours; null = "not on-boarding",
    // which has to CLEAR a deadline left over from a previous lobby
    onboardingEndsAt: closesAt === undefined ? state.onboardingEndsAt : closesAt ?? undefined,
  };
}
