// The reducer's one entry point: unwrap the event payload once, then hand the event to the
// family that owns it.
//
// The families are disjoint — no event name appears in two of them — so the order of the chain
// carries no meaning, and each family answers `undefined` for a name it does not own. That is
// what keeps the routing table in ONE place: the alternative, a top-level switch listing every
// name before delegating, spells each name twice and lets the two lists drift apart.

import type { ServerEvent } from '../gateway';
import { reduceBuyback } from './reduceBuyback';
import { reduceLobby } from './reduceLobby';
import { reduceRound } from './reduceRound';
import type { SurvivalState } from './state';

/**
 * The single payload object an event carries: jstp delivers every `survival` event as a
 * one-element argument list, so unwrapping it is `args[0]`.
 *
 * Exported because the spectator feed unwraps the SAME way — its own `spectatorLobbyChanged`
 * arrives on this identical path — and two private copies of this line are two places for the
 * empty-payload fallback to drift apart.
 */
export const eventPayload = (args: unknown[]): any =>
  Array.isArray(args) ? args[0] ?? {} : args ?? {};

/**
 * Reduce a server event into the survival state.
 * Event names mirror survival-server/src/lobby/lobby.ts and fight/survivalFight.ts.
 */
export function reduce(state: SurvivalState, ev: ServerEvent, myPlayerId?: string): SurvivalState {
  const p = eventPayload(ev.args);

  return (
    reduceLobby(state, ev.name, p) ??
    reduceRound(state, ev.name, p, myPlayerId) ??
    reduceBuyback(state, ev.name, p, myPlayerId) ??
    // an event nobody claims leaves the state alone, exactly as the old `default` did
    state
  );
}
