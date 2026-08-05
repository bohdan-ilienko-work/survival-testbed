// Getting this tab into a match, and back out of it.
//
// Connecting the two servers, buying a seat on main-server, binding the survival socket to the
// token that reply carries, and the one-click scenario that does all three. Everything here has
// to survive a testbed's two normal states — a lobby that is mid-fight, and a binding that went
// stale under a reload — which is why the joins retry instead of dead-ending.

import type { Dispatch } from 'react';
import { initialState, readOnboardingClosesAt } from '../survival';
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
}

export function useMatchEntry(
  deps: ActionDeps,
  setSession: Dispatch<any>,
  setSurvivalLost: (lost: boolean) => void,
): MatchEntry {
  const { gw, run, pushLog, setState } = deps;

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

  // "Insufficient tickets" is the usual first-run trap: top up once and retry
  // instead of making the tester guess the button order.
  const joinWithTickets = async () => {
    try {
      return await gw().call<any>('main', 'beG', 'joinSurvival', []);
    } catch (err) {
      if (!/ticket/i.test((err as Error).message)) throw err;
      pushLog('немає тікетів → видаю 50 і пробую ще раз');
      await gw().grantTickets(50);
      return gw().call<any>('main', 'beG', 'joinSurvival', []);
    }
  };

  /**
   * There is exactly one lobby on the server. While a fight runs it accepts nobody,
   * so a late tab would just hit "Lobby is no longer accepting registrations".
   * Wait for the next one instead of dead-ending.
   */
  const joinWhenLobbyOpens = async () => {
    for (let attempt = 0; attempt < 80; attempt++) {
      try {
        return await joinWithTickets();
      } catch (err) {
        const msg = (err as Error).message;
        if (!/accepting registrations|No active lobby|Lobby is full/i.test(msg)) throw err;
        setState((s) => ({
          ...s,
          lastError: 'Матч уже йде — чекаю, поки відкриється наступне лоббі…',
        }));
        if (attempt === 0) pushLog(`лоббі зайняте (${msg}) — чекаю наступного`);
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
    throw new Error('не дочекався вільного лоббі за 4 хв');
  };

  /**
   * Bind the survival socket to the token and adopt the roster the reply carries.
   *
   * A player who joins an already-running lobby gets no `playerJoined` broadcast of their own —
   * they registered on main-server before this socket existed, so the roster broadcast that
   * announced them went out to everyone else. This reply is their only chance to learn who is
   * already in the lobby, which is why both entry paths have to go through here: when only one
   * of them applied the roster, the second tab rendered "гравців у лоббі: —" for the whole
   * on-boarding.
   */
  const bindSurvival = async (token: string) => {
    const bound: any = await gw().call('survival', 'survival', 'connect', [token]);
    // The same argument as the roster, one field further: this tab missed every broadcast that
    // went out before the socket existed, and `onboardingStarted` is one of them. Without this
    // the tab sat in an on-boarding lobby showing only «старт: 05.08.2026, 20:18:56» while the
    // tab next to it counted the seconds down.
    const closesAt = readOnboardingClosesAt(bound);
    setState((st) => ({
      ...st,
      players: Array.isArray(bound?.roster) ? bound.roster : st.players,
      lobbyState: bound?.state ?? st.lobbyState,
      lobbyId: bound?.lobbyId ?? st.lobbyId,
      // undefined = the server said nothing (old build) → keep ours; null = "not on-boarding",
      // which has to CLEAR a deadline left over from a previous lobby.
      onboardingEndsAt: closesAt === undefined ? st.onboardingEndsAt : closesAt ?? undefined,
    }));
    return bound;
  };

  // A stale binding is the usual cause of "Not authenticated" (page reloaded, gateway
  // restarted). Re-join once and retry instead of dead-ending the tester.
  const rejoinAndRetry = async (fn: () => Promise<unknown>) => {
    try {
      return await fn();
    } catch (err) {
      if (!/not authenticated|not connected/i.test((err as Error).message)) throw err;
      pushLog('зʼєднання втратило привʼязку → перезаходжу в лоббі');
      const res: any = await joinWithTickets();
      await gw().connectTarget('survival');
      // Re-binding is exactly when the held roster is most likely to be stale — the tab missed
      // every broadcast while it was unbound — so adopt the one the reply carries.
      if (res?.token) await bindSurvival(res.token);
      return fn();
    }
  };

  const startEverything = () =>
    run('повний сценарій', async () => {
      await gw().connectTarget('main');
      const s = await gw().mockUser(loadAccount());
      if (s?.accountId && s?.deviceId) saveAccount({ accountId: s.accountId, deviceId: s.deviceId });
      setSession(s);
      setState(initialState);

      const res: any = await joinWhenLobbyOpens();
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
      const res: any = await joinWhenLobbyOpens();
      setState((s) => ({
        ...s,
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
      const res = await gw().call('survival', 'survival', 'leaveLobby', []);
      setState(initialState);
      return res;
    }).catch(() => undefined);

  return { connectAll, startEverything, joinSurvival, leaveSurvival, rejoinAndRetry };
}
