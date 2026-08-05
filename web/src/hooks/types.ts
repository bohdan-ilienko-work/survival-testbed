// The vocabulary every state hook in this folder shares.
//
// A leaf on purpose: it imports the wire modules (gateway, survival) and nothing that imports it
// back, so the hooks can name each other's values in their own signatures without any pair of
// them ever closing an import cycle.

import type { Dispatch, SetStateAction } from 'react';
import type { Gateway } from '../gateway';
import type { SurvivalState } from '../survival';

/**
 * Reach the live gateway.
 *
 * A function and not the Gateway itself: the socket is re-created on every reconnect, so a hook
 * that captured the instance would go on calling a dead one.
 */
export type GetGateway = () => Gateway;

/**
 * Run one server call as a UI action: raise the busy label, log what came back, report a refusal.
 * Rejects with the original error — each caller decides whether that is worth re-throwing.
 */
export type Run = (label: string, fn: () => Promise<unknown>) => Promise<unknown>;

/**
 * What every action hook needs in order to talk to the servers and say what happened.
 *
 * Every member is identity-stable for the life of the app (`gw`, `run`, `runInDialog` and
 * `pushLog` are useCallback'd, `setState` comes from useState). That is what lets a hook close
 * over this object once — inside a useCallback with an empty dependency list — exactly as this
 * screen has always done.
 */
export interface ActionDeps {
  gw: GetGateway;
  run: Run;
  /** run(), except the refusal lands INSIDE the open dialog instead of on the stage */
  runInDialog: Run;
  pushLog: (line: string) => void;
  setState: Dispatch<SetStateAction<SurvivalState>>;
}

/**
 * Which dialog is up, at most one at a time.
 *
 * They are all different ways of looking at the SAME player, so stacking two would only ever
 * hide the thing underneath — and the match itself is never one of them: everything that IS the
 * fight (question, results, buyback, the lobby countdown) stays on the stage, because a dialog
 * over a running round is a dialog over a ticking deadline.
 */
export type Dialog = 'booking' | 'lobby' | 'quote' | 'character';

/**
 * What the player looks like right now, straight off beG.getContext's `userContext`
 * (main-server lib/contexts.js, formPublishablePlayerContext).
 *
 * Nothing else the client holds carries this: the gateway session is only
 * {accountId, deviceId, playerId, tabId}, and every roster row — the booking list AND the live
 * lobby — is the copy main-server stamped in at RegisterPlayer time, which is never refreshed
 * afterwards. So right after the editor changes a character, the rosters still show the old one
 * and this is the only field that tells the truth.
 */
export interface Profile {
  character?: number;
  flag?: string;
  name?: string;
  /**
   * Reborn players pick TWO categories, not three (lib/characters.js). Worth carrying even
   * though a fresh mock account is never reborn: the server answers the wrong-count case
   * through `api.beGenius.error` — singular, a typo for `errors` — so it throws instead of
   * calling back, and the client just hangs until the gateway's 15s timeout. A silent
   * timeout is the worst failure to hand a tester, so the count is driven by this flag.
   */
  reborn?: boolean;
}

/**
 * One raw reply a read-only dialog exists to show, with the moment it arrived.
 *
 * Kept out of SurvivalState for the same reason `booking` is: it is the snapshot of ONE call,
 * not the live match the survival events build up.
 */
export interface Snapshot {
  at: number;
  reply: unknown;
}
