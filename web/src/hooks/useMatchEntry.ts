// Getting this tab into a match, and back out of it.
//
// Connecting the two servers, buying a seat on main-server, binding the survival socket to the
// token that reply carries, and the one-click scenario that does all three. Everything here has
// to survive a testbed's three normal states — a lobby that is mid-fight, a binding that went
// stale under a reload, and a lobby that ENDED under this socket (C3) — which is why the joins
// go through ./joinPolicy instead of dead-ending, and the recovery paths live in
// ./survivalBinding next door.

import type { Dispatch } from 'react';
import { MATCH_IN_PROGRESS_TEXT, NO_MATCH, initialState, isLobbyEnded } from '../survival';
import { joinGateOpen, joinWhenLobbyOpens } from './joinPolicy';
import { makeSurvivalBinding } from './survivalBinding';
import { TARGETS } from './useGateway';
import { loadAccount, saveAccount } from './useSession';
import type { ActionDeps } from './types';

export interface MatchEntry {
  connectAll: () => Promise<unknown>;
  startEverything: () => Promise<unknown>;
  joinSurvival: () => Promise<unknown>;
  leaveSurvival: () => Promise<unknown>;
  /** wrap a survival call so a stale binding is re-joined once instead of dead-ending */
  rejoinAndRetry: (fn: () => Promise<unknown>) => Promise<unknown>;
  /** C3 "Lobby has ended": the one scene-reset + re-entry path every hook routes through */
  resetAndReenter: () => Promise<void>;
}

/** @param fetchBooking one raw beG.getSurvivalStatus read — the C4 gate consults it pre-join */
export function useMatchEntry(
  deps: ActionDeps,
  setSession: Dispatch<any>,
  setSurvivalLost: (lost: boolean) => void,
  fetchBooking: () => Promise<unknown>,
): MatchEntry {
  const { gw, run, setState } = deps;
  const { joinIO, gateIO, resetScene, bindSurvival, rejoinAndRetry, resetAndReenter } =
    makeSurvivalBinding(deps, fetchBooking);

  const connectAll = () =>
    run('connect all servers', async () => {
      const out: Record<string, string> = {};
      for (const t of TARGETS) {
        try {
          await gw().connectTarget(t);
          out[t] = 'ok';
        } catch (e) {
          out[t] = (e as Error).message;
        }
      }
      return out;
    }).catch(() => undefined);

  const startEverything = () =>
    run('повний сценарій', async () => {
      await gw().connectTarget('main');
      const s = await gw().mockUser(loadAccount());
      if (s?.accountId && s?.deviceId) saveAccount({ accountId: s.accountId, deviceId: s.deviceId });
      setSession(s);
      setState(initialState);

      // C4: the polite path — when the status already says a match is running, do not make
      // the server refuse a join it told us about in advance
      if (!(await joinGateOpen(gateIO))) return { skippedJoin: MATCH_IN_PROGRESS_TEXT };
      const res: any = await joinWhenLobbyOpens(joinIO);
      setState((st) => ({
        ...st,
        step: 'lobby',
        lastError: undefined,
        lobbyId: res?.lobbyId,
        lobbyState: res?.state,
        scheduledStartAt: res?.scheduledStartAt,
        tickets: res?.tickets ?? st.tickets,
      }));
      await gw().connectTarget('survival');
      if (res?.token) await bindSurvival(res.token);
      setSurvivalLost(false);
      return { playerId: s?.playerId, lobbyId: res?.lobbyId };
    }).catch(() => undefined);

  const joinSurvival = () =>
    run('beG.joinSurvival', async () => {
      if (!(await joinGateOpen(gateIO))) return { skippedJoin: MATCH_IN_PROGRESS_TEXT };
      const res: any = await joinWhenLobbyOpens(joinIO);
      setState((s) => ({
        ...s,
        // A NEW lobby, and the tab keeps whatever the LAST match left behind — its round
        // number, its mode, its final board, its `iAmEliminated`. Unreset, the stepbar
        // labelled a lobby still waiting for players «раунд 7 · CHRONO». The tickets the reply
        // carries are set below, after this, because those belong to the player, not the lobby.
        ...NO_MATCH,
        step: 'lobby',
        lobbyId: res?.lobbyId,
        lobbyState: res?.state,
        scheduledStartAt: res?.scheduledStartAt,
        tickets: res?.tickets ?? s.tickets,
      }));
      await gw().connectTarget('survival');
      if (res?.token) await bindSurvival(res.token);
      return res;
    }).catch(() => undefined);

  const leaveSurvival = () =>
    run('survival.leaveLobby', async () => {
      try {
        const res = await gw().call('survival', 'survival', 'leaveLobby', []);
        setState(initialState);
        return res;
      } catch (err) {
        // C3: an ended lobby refuses even the goodbye — but "ended" IS what leaving wanted,
        // so reset the scene instead of raising a red box. No re-entry from here: the player
        // asked OUT, and auto-joining the next lobby would be the exact opposite.
        if (!isLobbyEnded((err as Error).message)) throw err;
        resetScene();
        return { ok: true, lobbyAlreadyOver: true };
      }
    }).catch(() => undefined);

  return { connectAll, startEverything, joinSurvival, leaveSurvival, rejoinAndRetry, resetAndReenter };
}
