// The websocket to the testbed gateway, and the feeds it produces on its own: the per-target
// connection status, the raw server events, the log, and the "survival is gone" flag.
//
// What to DO with a survival event, and how to sign this tab back in, are deliberately not this
// module's business — both arrive as handlers. The socket has to exist before the state hooks
// that consume it (they need `gw` to make any call at all), so it must not import them.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Gateway, type ServerEvent, type Target, type TargetState } from '../gateway';
import type { GetGateway } from './types';

export const TARGETS: Target[] = ['main', 'survival'];

export interface GatewayHandlers {
  /**
   * The socket is up. Every websocket is a fresh gateway client, so a reconnect (gateway
   * restart, vite hot reload) must sign this tab back in or every call answers
   * "Not authenticated" while the UI still shows the old match.
   *
   * The Gateway is handed over as an argument instead of being read back through `gw()`: this
   * fires from inside connect(), while the instance is still being wired up.
   */
  onOpen: (gw: Gateway) => void;
  /** one event from the survival target, in arrival order */
  onSurvivalEvent: (ev: ServerEvent) => void;
}

export interface GatewayConnection {
  gw: GetGateway;
  gwOnline: boolean;
  status: Record<Target, TargetState>;
  /** newest first, capped — the «Події сервера» list */
  events: ServerEvent[];
  /** newest first, capped — the «Лог» list */
  logs: string[];
  pushLog: (line: string) => void;
  /** the survival socket is not connected: whatever match is on screen is a ghost */
  survivalLost: boolean;
  setSurvivalLost: (lost: boolean) => void;
}

export function useGateway(handlers: GatewayHandlers): GatewayConnection {
  const gwRef = useRef<Gateway | null>(null);
  const [gwOnline, setGwOnline] = useState(false);
  const [status, setStatus] = useState<Record<Target, TargetState>>({
    main: 'idle',
    survival: 'idle',
  });
  const [events, setEvents] = useState<ServerEvent[]>([]);
  const [logs, setLogs] = useState<string[]>([]);
  const [survivalLost, setSurvivalLost] = useState(false);

  // The handlers are re-read at call time rather than captured, so that changing them can never
  // re-run the effect below — see the note on its dependency list.
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  const pushLog = useCallback(
    (line: string) =>
      setLogs((l) => [`${new Date().toLocaleTimeString()} · ${line}`, ...l].slice(0, 200)),
    [],
  );

  const gw = useCallback(() => gwRef.current!, []);

  useEffect(() => {
    const gateway = new Gateway();
    gwRef.current = gateway;
    gateway.onOpen = (hello: any) => {
      setGwOnline(true);
      pushLog(`gateway connected · вкладка #${hello?.tabId ?? '?'}`);
      handlersRef.current.onOpen(gateway);
    };
    gateway.onClose = () => setGwOnline(false);
    gateway.onStatus = (target, st, info) => {
      setStatus((s) => ({ ...s, [target]: st }));
      pushLog(`${target}: ${st}${info ? ` (${info})` : ''}`);
      // The match lives only in the survival-server's memory: once the socket drops
      // (server restart, crash) whatever is on screen is a ghost of a fight that no
      // longer exists. Say so instead of leaving a frozen round.
      if (target === 'survival') setSurvivalLost(st !== 'connected');
    };
    gateway.onLog = (line) => pushLog(line);
    gateway.onEvent = (ev) => {
      setEvents((list) => [ev, ...list].slice(0, 300));
      if (ev.target === 'survival') handlersRef.current.onSurvivalEvent(ev);
    };
    gateway.connect();
    return () => gateway.close();
    // pushLog is a useCallback with no dependencies, so its identity never changes and listing it
    // cannot re-run this effect — which it must not, since re-running would tear the gateway
    // socket down and re-create it under a live match. That is also why the two handlers go
    // through handlersRef instead of appearing here.
  }, [pushLog]);

  return { gw, gwOnline, status, events, logs, pushLog, survivalLost, setSurvivalLost };
}
