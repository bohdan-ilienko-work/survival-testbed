// Thin client for the testbed gateway (JSON over WebSocket).
// The gateway does the real JSTP talking to main-server and survival-server.

export type Target = 'main' | 'survival';
export type TargetState = 'idle' | 'connected' | 'disconnected' | 'error';

export interface ServerEvent {
  target: Target;
  iface: string;
  name: string;
  args: unknown[];
  at: number;
}

type Pending = { resolve: (v: any) => void; reject: (e: Error) => void };

export class Gateway {
  private ws: WebSocket | null = null;
  private seq = 1;
  private pending = new Map<number, Pending>();
  /** set by close(): stops the reconnect loop so a torn-down instance stays dead */
  private closed = false;

  onEvent: (e: ServerEvent) => void = () => {};
  onStatus: (target: Target, state: TargetState, info?: string) => void = () => {};
  onLog: (line: string) => void = () => {};
  onOpen: (hello: unknown) => void = () => {};
  onClose: () => void = () => {};

  connect(url = `ws://${location.hostname}:8787`): void {
    const ws = new WebSocket(url);
    this.ws = ws;

    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data as string);
      switch (msg.type) {
        case 'hello':
          this.onOpen(msg);
          break;
        case 'result': {
          const p = this.pending.get(msg.id);
          if (!p) return;
          this.pending.delete(msg.id);
          msg.ok ? p.resolve(msg.data) : p.reject(new Error(msg.error));
          break;
        }
        case 'event':
          this.onEvent({ ...msg, at: Date.now() });
          break;
        case 'status':
          this.onStatus(msg.target, msg.state, msg.info);
          break;
        case 'log':
          this.onLog(msg.line);
          break;
      }
    };

    ws.onclose = () => {
      if (this.closed) return;
      this.onClose();
      // keep the testbed usable across gateway restarts
      setTimeout(() => {
        if (!this.closed) this.connect(url);
      }, 1500);
    };
    ws.onerror = () => this.onLog('gateway socket error');
  }

  /**
   * Tear the socket down for good. Without this, React StrictMode's double mount
   * leaves an orphan socket alive: the gateway then holds two independent players
   * for one tab and the UI ends up talking to the wrong (unauthenticated) one.
   */
  close(): void {
    this.closed = true;
    try {
      this.ws?.close();
    } catch {
      // already gone
    }
    this.ws = null;
  }

  private send<T>(payload: Record<string, unknown>): Promise<T> {
    return new Promise((resolve, reject) => {
      const ws = this.ws;
      if (!ws || ws.readyState !== ws.OPEN) return reject(new Error('gateway offline'));
      const id = this.seq++;
      this.pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, ...payload }));
      setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error('gateway timeout'));
      }, 20000);
    });
  }

  connectTarget(target: Target) {
    return this.send<{ target: Target }>({ type: 'connect', target });
  }

  call<T = any>(target: Target, iface: string, method: string, args: unknown[] = []) {
    return this.send<T>({ type: 'call', target, iface, method, args });
  }

  /**
   * `account` is the {accountId, deviceId} this tab kept in sessionStorage, so a
   * reload stays the same player. A new tab has none and therefore gets a fresh
   * player — that is what makes multi-tab testing work.
   */
  mockUser(account?: { accountId: string; deviceId: string } | null) {
    return this.send<any>({ type: 'mockUser', account: account ?? null });
  }

  grantTickets(amount = 50) {
    return this.send<any>({ type: 'grantTickets', amount });
  }

  resetUser() {
    return this.send<any>({ type: 'resetUser' });
  }

  state() {
    return this.send<any>({ type: 'state' });
  }
}
