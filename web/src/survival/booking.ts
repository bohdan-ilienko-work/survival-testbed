// ─── the booking screen (beG.getSurvivalStatus) ───────────────────────────────
//
// The two RPC replies the UI has to POLL rather than receive as events, and the types that
// describe them. Their own file because they are not part of the event stream at all: the
// booking popup is shown hours before the match, when there is no survival session to listen on.

import { asBool, asNum, asPlayers, asTag } from './guards';
import type { LobbyPlayer } from './wire';

/**
 * The lobby object main-server passes straight through from survival-server's GetActiveLobby.
 *
 * `roster` is the whole point of it: the booking popup is shown in the main menu HOURS before
 * the match while a survival connect token lives ten minutes, so there is no JSTP session to
 * ask — this reply is the only way that screen can list who signed up.
 */
export interface BookingLobby {
  lobbyId?: string;
  state?: string;
  /** everybody registered, bots included */
  playerCount?: number;
  /** those still in the fight — equal to playerCount while the lobby is still booking */
  activePlayerCount?: number;
  /** ISO string */
  scheduledStartAt?: string;
  round?: number;
  /**
   * REGISTRATION ORDER IS PART OF THE CONTRACT: the booking screen numbers its rows from the
   * array index, because `slot` stays null until on-boarding hands the slots out. So the
   * roster is carried through as it arrived — never sorted, filtered or de-duplicated.
   */
  roster: LobbyPlayer[];
}

/** A beG.getSurvivalStatus reply, guarded. */
export interface BookingStatus {
  /** false = survival-server never answered, so there is nothing to register for at all */
  available?: boolean;
  /** am I in THIS lobby — main-server matches its paid entry against the current lobbyId */
  registered?: boolean;
  lobby: BookingLobby | null;
  tickets?: number;
  entryCost?: number;
  freeDailyTickets?: number;
  /**
   * How many free daily tickets THIS call granted — a count, not a flag: getStatus returns
   * claimFreeDailyTickets()'s result, which is 0 when today's ticket was already taken.
   * Read as a boolean it came back undefined every single time.
   */
  freeDailyGranted?: number;
  nextFreeDailyAt?: string;
  /** when this snapshot was taken — nothing pushes it, the screen has to poll */
  fetchedAt: number;
}

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
          round: asNum(raw.round),
          // no lobby means no roster, and an empty roster is not the same as "not an array"
          roster: asPlayers(raw.roster, []),
        }
      : null;

  return {
    available: asBool(r.available),
    registered: asBool(r.registered),
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
