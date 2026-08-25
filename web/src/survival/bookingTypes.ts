// ─── the shapes of the RPC replies (beG.getSurvivalStatus) ────────────────────
//
// A LEAF module like wire.ts: it imports only wire types, so the components that merely NAME a
// booking reply (the dialog, the roster, the header) never pull the guards and the reducer
// helpers in behind it. Split out of booking.ts when the events-per-day fields pushed that file
// over the 200-line budget.

import type { LobbyPlayer, RankReward } from './wire';

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
  /** which of the day's tournaments this lobby is (1-based) — 1/1 on a single-event day */
  eventNo?: number;
  /** how many tournaments today holds */
  eventsTotal?: number;
  round?: number;
  /**
   * REGISTRATION ORDER IS PART OF THE CONTRACT: the booking screen numbers its rows from the
   * array index, because `slot` stays null until on-boarding hands the slots out. So the
   * roster is carried through as it arrived — never sorted, filtered or de-duplicated.
   */
  roster: LobbyPlayer[];
  /**
   * What this lobby would pay for the field it holds RIGHT NOW — row i is place i+1, places
   * past the last row are unpaid. It moves as people join: the prize pool is a function of the
   * field size, so a tournament screen cannot state it from a table of its own.
   */
  rewardTable?: RankReward[];
}

/** A beG.getSurvivalStatus reply, guarded. */
export interface BookingStatus {
  /** false = survival-server never answered, so there is nothing to register for at all */
  available?: boolean;
  /** am I in THIS lobby — main-server matches its paid entry against the current lobbyId */
  registered?: boolean;
  /**
   * C4: may joinSurvival succeed right now? `false` while `registered` is also false means a
   * match is RUNNING — joinSurvival will only refuse, so the screen should say «матч уже йде»
   * (MATCH_IN_PROGRESS_TEXT) instead of calling it. `undefined` = an older main-server that
   * never said; keep the legacy behaviour of simply trying the join.
   */
  joinable?: boolean;
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
