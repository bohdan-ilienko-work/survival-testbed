// The join-retry policy: what a refused join MEANS, and the loops and gates that act on it.
//
// Pulled out of useMatchEntry so that every refusal the server can utter is classified in ONE
// typed place. The server's answers are prose, and prose grows: a new refusal matched by no arm
// below used to either dead-end the tester or be retried forever, depending on which inline
// regex it happened to miss. Now it lands as `unknown` (rethrown, visible in the log) until a
// new verdict kind is added HERE — the loops and the hook do not change.

import { MATCH_IN_PROGRESS_TEXT, isLobbyEnded, readBookingStatus } from '../survival';

/** What one refused join attempt means, and therefore what the caller does next. */
export type JoinVerdict =
  /** «Insufficient tickets» — the usual first-run trap: top up once and try again */
  | 'no-tickets'
  /** the single lobby is mid-fight or full — wait for the next one */
  | 'lobby-busy'
  /** already played / nothing is booking — same cadence as lobby-busy, its own words */
  | 'no-booking'
  /** C3: the lobby this socket belonged to is OVER — a scene-reset signal, not a refusal */
  | 'lobby-ended'
  /** nothing this policy knows how to absorb — rethrow, so the refusal stays visible */
  | 'unknown';

/**
 * The classifier matches SERVER STRINGS — they are the wire contract, fragile by nature, so
 * every sentence an arm depends on is spelled out next to it. A reworded refusal degrades to
 * `unknown` (rethrown and visible in the log), never into the wrong arm.
 */
export function classifyJoinRefusal(message: string): JoinVerdict {
  // "Insufficient tickets" — main-server's chargeEntry (lib/survival.js)
  if (/ticket/i.test(message)) return 'no-tickets';
  // "Lobby has ended" — survival-server's LOBBY_OVER_ERROR (server.ts): the answer EVERY RPC
  // of an ended-lobby socket gets. isLobbyEnded is the one shared detector for it (C3).
  if (isLobbyEnded(message)) return 'lobby-ended';
  // "No lobby is open for booking right now" — main-server joinSurvival's pre-charge gate:
  // this player's match FINISHED (already played) or the next one is already ACTIVE
  if (/open for booking/i.test(message)) return 'no-booking';
  // "Lobby is no longer accepting registrations", "Lobby is full" — survival-server's
  // RegisterPlayer (lobby.ts); "No active lobby" — main-server joinSurvival when
  // survival-server reports no lobby at all
  if (/accepting registrations|No active lobby|Lobby is full/i.test(message)) return 'lobby-busy';
  return 'unknown';
}

/**
 * RPC refusals that mean the survival BINDING died (page reloaded, gateway restarted) — the
 * call itself was fine and is worth repeating once the socket is re-bound. Matches
 * "Not authenticated" (survival-server, a socket it does not know) and the gateway's own
 * "not connected". An ended lobby is NOT this: it answers "Lobby has ended" instead (C3).
 */
export const isStaleBinding = (message: string): boolean =>
  /not authenticated|not connected/i.test(message);

/** The few things the policy needs a hand for — the calls themselves, and where each arm reports. */
export interface JoinAttemptIO {
  /** one raw beG.joinSurvival call */
  join: () => Promise<unknown>;
  /** the top-up the no-tickets arm spends */
  grantTickets: () => Promise<unknown>;
  /** the no-tickets arm fired — say so in the log */
  onTopUp: () => void;
  /** the lobby-busy arm fired — put the waiting notice where the tester can see it */
  onBusy: (message: string, attempt: number) => void;
  /** the no-booking arm fired — same cadence as onBusy, distinct words, so the log tells them apart */
  onNoBooking: (message: string, attempt: number) => void;
  /** C3 mid-wait: the lobby we aimed at ENDED — reset the scene; the loop itself stays the re-entry */
  onEnded: (message: string) => void;
}

/**
 * One join attempt, with the ticket top-up folded in: without it "Insufficient tickets" makes
 * the tester guess the button order on every first run. The retry after the top-up is
 * deliberately un-caught — a SECOND ticket refusal means granting does not help, so it must
 * fall through to the caller instead of looping on grants.
 */
export async function joinWithTicketTopUp(io: JoinAttemptIO): Promise<unknown> {
  try {
    return await io.join();
  } catch (err) {
    if (classifyJoinRefusal((err as Error).message) !== 'no-tickets') throw err;
    io.onTopUp();
    await io.grantTickets();
    return io.join();
  }
}

// 80 attempts every 3 s is the «4 хв» in the give-up message below — change them together.
const MAX_ATTEMPTS = 80;
const RETRY_DELAY_MS = 3000;

/**
 * There is exactly one lobby on the server. While a fight runs it accepts nobody, so a late
 * tab would just hit "Lobby is no longer accepting registrations". Wait for the next one
 * instead of dead-ending; every verdict WITHOUT an arm below is rethrown, because retrying a
 * refusal we do not understand only hides it for four minutes.
 */
export async function joinWhenLobbyOpens(io: JoinAttemptIO): Promise<unknown> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      return await joinWithTicketTopUp(io);
    } catch (err) {
      const message = (err as Error).message;
      const verdict = classifyJoinRefusal(message);
      // C3: "Lobby has ended" is not a refusal of THIS join — the PREVIOUS lobby died under
      // us. Reset the scene now (a stale board must not sit under the waiting notice) and
      // keep the cadence: the next attempt IS the re-entry into whatever opens next.
      if (verdict === 'lobby-ended') io.onEnded(message);
      else if (verdict === 'no-booking') io.onNoBooking(message, attempt);
      else if (verdict === 'lobby-busy') io.onBusy(message, attempt);
      else throw err;
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
    }
  }
  throw new Error('не дочекався вільного лоббі за 4 хв');
}

/** What the C4 pre-join gate needs: one status read, and where its verdict lands. */
export interface JoinGateIO {
  /** one raw beG.getSurvivalStatus call */
  fetchStatus: () => Promise<unknown>;
  /** the gate said no — the polite reason, where the tester reads it */
  onClosed: (text: string) => void;
  log: (line: string) => void;
}

/**
 * C4: beG.getSurvivalStatus now answers `joinable`. `false` while `registered` is ALSO false
 * means a match is RUNNING — joinSurvival would only refuse, so the polite path is to not call
 * it at all. Everything else falls through to the join: `joinable: undefined` is an older
 * main-server that never said, and registered=true is the free reconnect the server allows.
 */
export async function joinGateOpen(io: JoinGateIO): Promise<boolean> {
  try {
    const status = readBookingStatus(await io.fetchStatus());
    if (status.joinable === false && status.registered === false) {
      io.onClosed(MATCH_IN_PROGRESS_TEXT);
      io.log('joinable=false, registered=false → joinSurvival не викликаю');
      return false;
    }
  } catch (err) {
    // advisory only: a failed status read must not cost the legacy join path its chance
    io.log(`beG.getSurvivalStatus ✗ ${(err as Error).message} — пробую зайти як раніше`);
  }
  return true;
}
