// What a player does once the fight is running: answer, watch an ad, buy their way back in —
// and the two calls that ask the survival-server to describe itself.
//
// Every one of these needs a survival socket that is already bound (survival-server checks
// `connectedClients.get(connection)` first), which is what separates them from the main-server
// actions next door.

import { useCallback, useEffect, useState } from 'react';
import type { Dispatch, RefObject, SetStateAction } from 'react';
import type { TargetState } from '../gateway';
import {
  applyBuyBackQuote,
  errorText,
  readOnboardingClosesAt,
  type SurvivalState,
} from '../survival';
import type { ActionDeps, Dialog, Snapshot } from './types';

export interface MatchActions {
  submitAnswer: (answer: unknown) => Promise<unknown>;
  buyBack: () => Promise<unknown>;
  recordAdView: () => Promise<unknown>;
  quoteBuyBack: () => Promise<unknown>;
  /** the price dialog's own refresh button */
  refreshQuote: () => void;
  lobbyStatus: () => Promise<unknown>;
  /** the raw replies the two read-only dialogs exist to show */
  lobbyInfo: Snapshot | null;
  quoteInfo: Snapshot | null;
  forgetSnapshots: () => void;
}

export interface MatchActionsContext {
  state: SurvivalState;
  /** the survival socket's own state — the auto-quote below must not ask an unbound socket */
  survivalStatus: TargetState;
  dialogRef: RefObject<Dialog | null>;
  setDialogError: Dispatch<SetStateAction<string | null>>;
  rejoinAndRetry: (fn: () => Promise<unknown>) => Promise<unknown>;
}

export function useMatchActions(deps: ActionDeps, ctx: MatchActionsContext): MatchActions {
  const { gw, run, runInDialog, pushLog, setState } = deps;
  const { state, survivalStatus, dialogRef, setDialogError, rejoinAndRetry } = ctx;
  const [lobbyInfo, setLobbyInfo] = useState<Snapshot | null>(null);
  const [quoteInfo, setQuoteInfo] = useState<Snapshot | null>(null);

  const submitAnswer = (answer: unknown) =>
    run(`survival.submitAnswer ${JSON.stringify(answer)}`, async () => {
      setState((s) => ({ ...s, myAnswer: answer }));
      return rejoinAndRetry(() => gw().call('survival', 'survival', 'submitAnswer', [answer]));
    }).catch(() => undefined);

  // Both halves now say the same thing: the lobby emits the private `buyBackDenied`
  // with the machine reason, and survival.buyBack rejects with that same reason instead
  // of the old hardcoded "BuyBack denied", so run()'s catch overwriting `lastError` no
  // longer loses information.
  const buyBack = () =>
    run('survival.buyBack', () => gw().call('survival', 'survival', 'buyBack', [])).catch(
      () => undefined,
    );

  const recordAdView = () =>
    run('survival.recordAdView', () => gw().call('survival', 'survival', 'recordAdView', [])).catch(
      () => undefined,
    );

  /**
   * The price is a private, per-player number: it arrives once, as `buyBackOffer`, at
   * the moment the window opens. A tab that reconnects mid-window (or missed the event)
   * would otherwise show a button with no price — ask the server instead.
   * Not routed through run(): a server that does not know the method yet is a testbed
   * fact for the log, not an error to shout at the player.
   */
  const quoteBuyBack = useCallback(async () => {
    try {
      const res: any = await gw().call('survival', 'survival', 'getBuyBackQuote', []);
      pushLog(`survival.getBuyBackQuote → ${String(JSON.stringify(res)).slice(0, 200)}`);
      setState((s) => applyBuyBackQuote(s, res));
      setQuoteInfo({ at: Date.now(), reply: res });
      return res;
    } catch (err) {
      const msg = (err as Error).message;
      pushLog(`survival.getBuyBackQuote ✗ ${msg}`);
      if (!/no method/i.test(msg)) setState((s) => ({ ...s, lastError: errorText(msg) }));
      // Shown in the price dialog too, and even for "no method": that answer is exactly the
      // finding the dialog exists to surface, though it is not one the stage should shout
      // about. Only when THAT dialog is the open one — this also runs from the effect below,
      // which fires on its own during a match.
      if (dialogRef.current === 'quote') setDialogError(msg);
      return undefined;
    }
    // every one of these is identity-stable, so this callback never changes — the effect below
    // depends on it and must not be re-armed by a re-render
  }, [gw, pushLog, setState, dialogRef, setDialogError]);

  // Ask for the price whenever we are inside a window without one — covers a reconnect,
  // a missed event, and a rival's BuyBack that reopened the "too few players" gate.
  useEffect(() => {
    if (state.step !== 'buyback' || !state.buybackOpen) return;
    if (state.buybackCost !== undefined || state.buybackUnavailableReason) return;
    if (survivalStatus !== 'connected') return;
    void quoteBuyBack();
  }, [
    state.step,
    state.buybackOpen,
    state.buybackCost,
    state.buybackUnavailableReason,
    survivalStatus,
    quoteBuyBack,
  ]);

  // quoteBuyBack never rejects — it reports through dialogError, which is why this clears the
  // box itself instead of leaving that to runInDialog the way every other button does.
  const refreshQuote = () => {
    setDialogError(null);
    void quoteBuyBack();
  };

  const lobbyStatus = () =>
    runInDialog('survival.getLobbyStatus', async () => {
      const res: any = await gw().call('survival', 'survival', 'getLobbyStatus', []);
      // Same absolute deadline the connect reply carries — this call is the manual way back to
      // it for a tab that already bound but still has no countdown (a missed broadcast).
      const closesAt = readOnboardingClosesAt(res);
      setState((s) => ({
        ...s,
        lobbyState: res?.state,
        lobbyId: res?.lobbyId ?? s.lobbyId,
        players: Array.isArray(res?.roster) ? res.roster : s.players,
        onboardingEndsAt: closesAt === undefined ? s.onboardingEndsAt : closesAt ?? undefined,
      }));
      // Kept raw as well: the dialog exists to show what the server actually answered, not only
      // the four fields the reducer keeps.
      setLobbyInfo({ at: Date.now(), reply: res });
      return res;
    });

  /** Both snapshots describe a player who is being replaced — see useSession's mockUser. */
  const forgetSnapshots = () => {
    setLobbyInfo(null);
    setQuoteInfo(null);
  };

  return {
    submitAnswer,
    buyBack,
    recordAdView,
    quoteBuyBack,
    refreshQuote,
    lobbyStatus,
    lobbyInfo,
    quoteInfo,
    forgetSnapshots,
  };
}
