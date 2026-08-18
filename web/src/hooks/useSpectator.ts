// Watching a match without joining it: the two RPCs, the event feed they arm, and the one
// timer that exists because a world with no lobby broadcasts nothing.
//
// Nothing here touches main-server, and nothing here needs a player. `survival.spectate` is
// answered by a socket that has never called `survival.connect`, so the whole entry path is
// «підключити survival» → «spectate». That absence IS the feature: until now the only way to
// know whether a match was running was to read the server's log.

import { useCallback, useEffect, useState } from 'react';
import type { ServerEvent } from '../gateway';
import {
  applySpectatorSnapshot,
  emptySpectatorFeed,
  readSpectatorSnapshot,
  reduceSpectator,
  withSnapshotTiebreak,
  type SpectatorFeed,
} from '../survival';
import type { ActionDeps } from './types';

/**
 * The language the snapshot's question text is served in.
 *
 * 'en' because every mock player this gateway signs up is created with `language: 'en'`, so a
 * watch tab renders the SAME question text as the player tab beside it — and comparing those
 * two windows is exactly what this stand is for. The server localises the reply itself
 * (localizePayload runs on the FightSnapshot), so a wrong code here would not break anything;
 * it would quietly show a different translation than the players see, which is worse.
 */
const SPECTATOR_LANG = 'en';

/**
 * How often to re-ask while there is NO lobby at all.
 *
 * ≥5 s on purpose: `spectate` refuses a re-call sooner than SURVIVAL_SPECTATE_MIN_INTERVAL_MS
 * (1000 by default) with 'too_fast', and a client that polls into its own rate limit turns a
 * quiet wait into a stream of red boxes.
 */
const NO_LOBBY_POLL_MS = 5000;

export interface Spectator {
  feed: SpectatorFeed;
  /** the flag App reads to swap the stage for the watch screen */
  watching: boolean;
  /** survival.spectate — the entry AND the re-sync, because the server makes it idempotent */
  watch: () => Promise<unknown>;
  stopWatching: () => Promise<unknown>;
  /** one survival event, while watching */
  onEvent: (ev: ServerEvent) => void;
}

export function useSpectator(deps: ActionDeps): Spectator {
  const { gw, run, pushLog, setState } = deps;
  const [feed, setFeed] = useState<SpectatorFeed>(emptySpectatorFeed);

  const takeSnapshot = useCallback(
    async () => {
      const reply = await gw().call('survival', 'survival', 'spectate', [SPECTATOR_LANG]);
      // The tiebreak block is folded in from the RAW reply — a watcher that arrives mid
      // sudden death has no events left to learn it from. See withSnapshotTiebreak.
      setFeed(withSnapshotTiebreak(applySpectatorSnapshot(readSpectatorSnapshot(reply)), reply));
      return reply;
    },
    [gw],
  );

  const watch = () =>
    run('survival.spectate', async () => {
      // The only connection a watcher needs. No mock user, no tickets, no beG.joinSurvival:
      // survival-server's client port answers an unbound socket and refuses per METHOD, so
      // there is nothing to authenticate as.
      await gw().connectTarget('survival');
      const reply = await takeSnapshot();
      // The shared error line belongs to the stage, and the watch screen REPLACES the stage —
      // a refusal from the previous attempt would otherwise sit above a snapshot that worked.
      setState((s) => (s.lastError === undefined ? s : { ...s, lastError: undefined }));
      return reply;
    }).catch(() => undefined);

  const stopWatching = () =>
    run('survival.stopSpectating', async () => {
      try {
        return await gw().call('survival', 'survival', 'stopSpectating', []);
      } finally {
        // Leaving is the CLIENT's decision, and the seat is freed by the socket closing anyway
        // (releaseConnection deletes it there too). A refused goodbye must not strand the tab
        // on a watch screen it can no longer leave.
        setFeed(emptySpectatorFeed);
      }
    }).catch(() => undefined);

  const onEvent = useCallback((ev: ServerEvent) => setFeed((f) => reduceSpectator(f, ev)), []);

  /**
   * «Матч не заплановано» is the one state no event can ever wake this screen out of: with no
   * lobby there is nothing to broadcast to, and `spectatorLobbyChanged` only fires for a
   * spectator the rotation MOVED. So that single state re-asks, and no other does — while a
   * lobby exists every change already arrives as a broadcast and polling would only burn
   * snapshots against the rate limit.
   */
  useEffect(() => {
    if (!feed.watching || feed.state.step !== 'idle') return;
    const timer = setInterval(() => {
      // Quietly: an automatic re-ask that misses is a log line, not an error box over a screen
      // whose whole message is «поки нічого не відбувається».
      void takeSnapshot().catch((err: Error) =>
        pushLog(`survival.spectate (чекаю на лоббі) ✗ ${err.message}`),
      );
    }, NO_LOBBY_POLL_MS);
    return () => clearInterval(timer);
  }, [feed.watching, feed.state.step, takeSnapshot, pushLog]);

  return { feed, watching: feed.watching, watch, stopWatching, onEvent };
}
