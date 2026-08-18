// Keeping this tab's survival binding truthful: the connect that adopts everything the socket
// missed, and the two recovery paths RPC refusals route into.
//
// Split from useMatchEntry when the C3 scene-reset path pushed it over the 200-line budget:
// this half is "what to do when the binding went stale or its lobby is OVER", the hook next
// door keeps "how a tab enters and leaves a match". Plain closures, not a React hook — it
// holds no state of its own; everything lands in SurvivalState through deps.setState.

import { LOBBY_ENDED_TEXT, MATCH_IN_PROGRESS_TEXT, applyConnectReply, enterLobby } from '../survival';
import { isStaleBinding, joinGateOpen, joinWithTicketTopUp } from './joinPolicy';
import type { JoinAttemptIO, JoinGateIO } from './joinPolicy';
import type { ActionDeps } from './types';

export interface SurvivalBinding {
  /** how the join policy touches THIS tab — shared by every loop, gate and recovery below */
  joinIO: JoinAttemptIO;
  /** the C4 pre-join gate's plumbing — see joinPolicy.joinGateOpen */
  gateIO: JoinGateIO;
  /** C3: the deliberate scene reset — what "Lobby has ended" means, minus the re-entry */
  resetScene: () => void;
  /** bind the survival socket to a join token and adopt the connect reply */
  bindSurvival: (token: string) => Promise<any>;
  /** wrap a survival call so a stale binding is re-joined once instead of dead-ending */
  rejoinAndRetry: (fn: () => Promise<unknown>) => Promise<unknown>;
  /** C3 "Lobby has ended": the one scene-reset + re-entry path every hook routes through */
  resetAndReenter: () => Promise<void>;
}

/** @param fetchBooking one raw beG.getSurvivalStatus read — the C4 gate consults it pre-join */
export function makeSurvivalBinding(
  deps: ActionDeps,
  fetchBooking: () => Promise<unknown>,
): SurvivalBinding {
  const { gw, pushLog, setState } = deps;

  // C3: the very state the connect reply's explicit "no lobby" arm lands (player-scoped wallet
  // kept, everything lobby-scoped cleared), plus the one line that tells the player WHY the
  // board just went away instead of leaving a silent blank menu.
  const resetScene = () =>
    setState((s) => ({ ...applyConnectReply(s, { lobbyId: null }), lastError: LOBBY_ENDED_TEXT }));

  // Which SERVER STRING lands in which arm lives in ./joinPolicy, next to the classifier.
  const joinIO: JoinAttemptIO = {
    join: () => gw().call('main', 'beG', 'joinSurvival', []),
    grantTickets: () => gw().grantTickets(50),
    onTopUp: () => pushLog('немає тікетів → видаю 50 і пробую ще раз'),
    onBusy: (message, attempt) => {
      setState((s) => ({
        ...s,
        lastError: 'Матч уже йде — чекаю, поки відкриється наступне лоббі…',
      }));
      if (attempt === 0) pushLog(`лоббі зайняте (${message}) — чекаю наступного`);
    },
    // "No lobby is open for booking right now": already played / the next match is running —
    // the calm words, the same 3 s cadence, a label of its own so the log tells the arms apart
    onNoBooking: (message, attempt) => {
      setState((s) => ({ ...s, lastError: MATCH_IN_PROGRESS_TEXT }));
      if (attempt === 0) pushLog(`реєстрацію закрито (${message}) — чекаю на наступне лобі`);
    },
    onEnded: (message) => {
      resetScene();
      pushLog(`лобі завершилося (${message}) — сцену скинуто, чекаю наступного`);
    },
  };

  const gateIO: JoinGateIO = {
    fetchStatus: fetchBooking,
    onClosed: (text) => setState((s) => ({ ...s, lastError: text })),
    log: pushLog,
  };

  /**
   * Bind the survival socket to the token and let applyConnectReply adopt what the reply says.
   *
   * Both entry paths go through here because this reply is the ONLY message about broadcasts
   * this socket missed: a player joining an already-running lobby got no `playerJoined` of
   * their own, no `onboardingStarted`, and — after a reload across the finish — no final board.
   * applyConnectReply is the single reader for every shape the reply takes: a live snapshot,
   * the explicit "no lobby" (which CLEARS the stale one instead of ??-keeping it), and the C3
   * `lastResult`, which lands step 'finished' and thereby arms useTickets' payout re-read.
   */
  const bindSurvival = async (token: string) => {
    const bound: any = await gw().call('survival', 'survival', 'connect', [token]);
    // C3: `reconnected` is now true ONLY while a fight is truly ACTIVE, so it can be said out
    // loud — the round state itself arrives as the events the server re-emits on reconnect.
    if (bound?.reconnected === true) {
      pushLog('reconnected=true — бій ще активний, стан раунду прийде подіями');
    }
    // enterLobby FIRST: a reply for a DIFFERENT lobby than the one on screen means the
    // previous match's round, board and verdict are stale, and applyConnectReply merges rather
    // than replaces — so without this the new lobby inherited the old match's round number.
    setState((st) => applyConnectReply(enterLobby(st, bound?.lobbyId), bound));
    return bound;
  };

  /**
   * C3: "Lobby has ended" answers EVERY RPC of a socket whose lobby ENDED — the deliberate
   * scene-reset signal, not a failure. Reset first (a stale board must not outlive its lobby),
   * then re-enter through the SAME join+bind path every entry uses: within 120 s of the finish
   * the connect reply's lastResult puts the finished board straight back — re-arming the
   * payout re-read the reset just cancelled. A refused re-entry (nothing books yet) is a log
   * line, not an error: the reset itself already answered the player.
   */
  const resetAndReenter = async () => {
    resetScene();
    try {
      // Same C4 gate as every other entry: with a NEW match already running (tab slept across
      // a whole booking window), joinSurvival would only refuse — the calm «матч уже йде» is
      // the answer, not a red join error over a scene that was just cleanly reset.
      if (!(await joinGateOpen(gateIO))) return;
      const res: any = await joinWithTicketTopUp(joinIO);
      await gw().connectTarget('survival');
      if (res?.token) await bindSurvival(res.token);
      // The reset stamped its own explanation; a successful re-entry (fresh lobby or the
      // lastResult board) has nothing to apologise for — left standing, the line would sit
      // as a stale error banner above the restored screen.
      setState((s) => (s.lastError === LOBBY_ENDED_TEXT ? { ...s, lastError: undefined } : s));
    } catch (err) {
      pushLog(`повторний вхід поки неможливий (${(err as Error).message})`);
    }
  };

  // A stale binding is the usual cause of "Not authenticated" (page reloaded, gateway
  // restarted). Re-join once and retry instead of dead-ending the tester. An ended lobby is
  // deliberately NOT retried here — see resetAndReenter, which callers route that answer to.
  const rejoinAndRetry = async (fn: () => Promise<unknown>) => {
    try {
      return await fn();
    } catch (err) {
      if (!isStaleBinding((err as Error).message)) throw err;
      pushLog('зʼєднання втратило привʼязку → перезаходжу в лоббі');
      const res: any = await joinWithTicketTopUp(joinIO);
      await gw().connectTarget('survival');
      // Re-binding is exactly when the held roster is most likely to be stale — the tab missed
      // every broadcast while it was unbound — so adopt the one the reply carries.
      if (res?.token) await bindSurvival(res.token);
      return fn();
    }
  };

  return { joinIO, gateIO, resetScene, bindSurvival, rejoinAndRetry, resetAndReenter };
}
