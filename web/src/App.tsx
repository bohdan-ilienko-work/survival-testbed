import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Gateway, type ServerEvent, type Target, type TargetState } from './gateway';
import {
  applyBuyBackQuote,
  applyTicketBalance,
  errorText,
  initialState,
  reasonText,
  readBookingStatus,
  reduce,
  stepLabel,
  type BookingStatus,
  type LobbyPlayer,
  type SurvivalState,
} from './survival';
import { MapPicker } from './MapPicker';
import {
  characterFullUrl,
  characterIconUrl,
  characterName,
  flagImageUrl,
  unknownFlagUrl,
} from './gameAssets';
import './App.css';

const TARGETS: Target[] = ['main', 'survival'];

/**
 * Free country codes for «Змінити прапор». Every one of them is in main-server's
 * `api.beGenius.flags.free` (lib/flags.js) — checked against that list, not picked by taste,
 * because beG.changeFlag validates the code against `flags.all` and answers "Wrong flag name"
 * for anything else. Premium flags are deliberately absent: they are in `flags.all` but also
 * need `player.boughtFlags`, so a mock player only ever gets "not bought" out of them.
 */
const TEST_FLAGS = ['UA', 'PL', 'DE', 'FR', 'IT', 'ES', 'JP', 'BR', 'US', 'GB', 'SE', 'TR'];

/**
 * TEST_FLAGS rotated from a random start: the first code is the one we want, the rest are the
 * retries. changeFlag rejects the flag ALREADY selected ("Already selected") and the client
 * cannot know which one that is — the roster carries the flag stamped at REGISTRATION, not the
 * live one — so the answer is to have somewhere to go next instead of guessing.
 */
const flagsToTry = (): string[] => {
  const start = Math.floor(Math.random() * TEST_FLAGS.length);
  return TEST_FLAGS.map((_, i) => TEST_FLAGS[(start + i) % TEST_FLAGS.length]);
};

// sessionStorage is per-tab: a reload keeps this tab's player, a NEW tab starts
// with nothing stored and therefore gets a brand new mock player.
const ACCOUNT_KEY = 'survival-testbed:account';

const loadAccount = (): { accountId: string; deviceId: string } | null => {
  try {
    return JSON.parse(sessionStorage.getItem(ACCOUNT_KEY) || 'null');
  } catch {
    return null;
  }
};

const saveAccount = (a: { accountId: string; deviceId: string } | null) => {
  if (a) sessionStorage.setItem(ACCOUNT_KEY, JSON.stringify(a));
  else sessionStorage.removeItem(ACCOUNT_KEY);
};

export default function App() {
  const gwRef = useRef<Gateway | null>(null);
  const [gwOnline, setGwOnline] = useState(false);
  const [status, setStatus] = useState<Record<Target, TargetState>>({
    main: 'idle',
    survival: 'idle',
  });
  const [session, setSession] = useState<any>(null);
  const [state, setState] = useState<SurvivalState>(initialState);
  // Kept OUT of SurvivalState: this is a polled snapshot of main-server's booking screen, not
  // the live match the survival events build up. Mixing them would let a stale poll overwrite
  // a roster that broadcasts keep current.
  const [booking, setBooking] = useState<BookingStatus | null>(null);
  const [events, setEvents] = useState<ServerEvent[]>([]);
  const [logs, setLogs] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [survivalLost, setSurvivalLost] = useState(false);

  const playerId: string | undefined = session?.playerId;
  const playerIdRef = useRef<string | undefined>(undefined);
  playerIdRef.current = playerId;

  const pushLog = (line: string) =>
    setLogs((l) => [`${new Date().toLocaleTimeString()} · ${line}`, ...l].slice(0, 200));

  useEffect(() => {
    const gw = new Gateway();
    gwRef.current = gw;
    gw.onOpen = async (hello: any) => {
      setGwOnline(true);
      pushLog(`gateway connected · вкладка #${hello?.tabId ?? '?'}`);
      // Every websocket is a fresh gateway client, so a reconnect (gateway restart,
      // vite hot reload) must sign this tab back in or every call answers
      // "Not authenticated" while the UI still shows the old match.
      try {
        await gw.connectTarget('main');
        const s = await gw.mockUser(loadAccount());
        if (s?.accountId && s?.deviceId) saveAccount({ accountId: s.accountId, deviceId: s.deviceId });
        setSession(s);
        pushLog(`автовхід: гравець ${s?.playerId}`);
      } catch (e) {
        pushLog(`автовхід не вдався: ${(e as Error).message}`);
      }
    };
    gw.onClose = () => setGwOnline(false);
    gw.onStatus = (target, st, info) => {
      setStatus((s) => ({ ...s, [target]: st }));
      pushLog(`${target}: ${st}${info ? ` (${info})` : ''}`);
      // The match lives only in the survival-server's memory: once the socket drops
      // (server restart, crash) whatever is on screen is a ghost of a fight that no
      // longer exists. Say so instead of leaving a frozen round.
      if (target === 'survival') setSurvivalLost(st !== 'connected');
    };
    gw.onLog = (line) => pushLog(line);
    gw.onEvent = (ev) => {
      setEvents((list) => [ev, ...list].slice(0, 300));
      if (ev.target === 'survival') setState((s) => reduce(s, ev, playerIdRef.current));
    };
    gw.connect();
    return () => gw.close();
  }, []);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);

  const run = useCallback(async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label);
    try {
      const res = await fn();
      pushLog(`${label} → ${String(JSON.stringify(res)).slice(0, 300)}`);
      return res;
    } catch (err) {
      pushLog(`${label} ✗ ${(err as Error).message}`);
      // survival.buyBack rejects with the server's machine reason ('insufficient_tickets'),
      // not a sentence. errorText translates a known tag and passes real prose through.
      setState((s) => ({ ...s, lastError: errorText((err as Error).message) }));
      throw err;
    } finally {
      setBusy(null);
    }
  }, []);

  const gw = () => gwRef.current!;

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

  const mockUser = (fresh = false) =>
    run(fresh ? 'new mock player' : 'mock user sign in', async () => {
      if (fresh) saveAccount(null);
      const s = await gw().mockUser(fresh ? null : loadAccount());
      if (s?.accountId && s?.deviceId) saveAccount({ accountId: s.accountId, deviceId: s.deviceId });
      setSession(s);
      setState(initialState);
      // The booking snapshot belongs to the PREVIOUS account — above all its «зареєстрований»
      // pill, which would otherwise claim a brand-new player has already paid for a seat.
      setBooking(null);
      return { tab: s?.tabId, playerId: s?.playerId };
    }).catch(() => undefined);

  // Both top-ups below go straight to main-server, so survival-server never learns of them
  // and pushes no 'ticketsUpdated'. They must still go through applyTicketBalance: assigning
  // `tickets` raw leaves buybackAffordable on its old `false`, which kept the priced
  // «Викупитись» button dead for the rest of the window right next to a chip showing enough
  // tickets to pay for it.
  const grantTickets = () =>
    run('grant 50 tickets', async () => {
      const res: any = await gw().grantTickets(50);
      setState((s) => applyTicketBalance(s, res?.balance, { reason: 'grant' }));
      return res;
    }).catch(() => undefined);

  const refreshTickets = () =>
    run('beG.getTickets', async () => {
      const res: any = await gw().call('main', 'beG', 'getTickets', []);
      // beG.getTickets also grants the free daily ticket, so its reply can be a real movement
      setState((s) => applyTicketBalance(s, res?.tickets ?? res, { reason: 'refresh' }));
      return res;
    }).catch(() => undefined);

  /**
   * The booking / registration screen, and the only call that can draw it.
   *
   * It lives in the main menu hours before the match, when the player has no survival
   * connection at all (a connect token lives ten minutes), so main-server's
   * beG.getSurvivalStatus is the ONLY source of the sign-up list — that is why the roster now
   * travels with it. Nothing here touches `status.survival` on purpose: the whole point of the
   * panel is that it works for a player who has never joined and is connected to nothing but
   * main-server.
   *
   * Not wrapped in run() itself so «Створити клан» can refresh without nesting two run()s —
   * the inner finally would clear `busy` while the outer call is still going.
   */
  const fetchBooking = useCallback(async () => {
    const res = await gw().call<any>('main', 'beG', 'getSurvivalStatus', []);
    const status = readBookingStatus(res);
    setBooking(status);
    // getStatus claims the free daily ticket on its way, exactly like beG.getTickets, so its
    // balance can be a real movement — and it goes through applyTicketBalance for the same
    // reason the two top-ups above do.
    setState((s) => applyTicketBalance(s, status.tickets, { reason: 'status' }));
    return res;
  }, []);

  const bookingStatus = () => run('beG.getSurvivalStatus', fetchBooking).catch(() => undefined);

  /**
   * Testbed convenience, not a product feature: fresh mock accounts are clanless, so without
   * this the roster's clan column is empty on every row and the new field goes untested.
   * The clan NAME is copied into the roster row when RegisterPlayer runs and is never
   * refreshed afterwards, so a clan created after «Зайти в Survival» only shows up in the
   * NEXT lobby — hence the hint next to the button.
   */
  const mockClan = () =>
    run('mockClan (тестовий клан)', async () => {
      const clan = await gw().mockClan();
      await fetchBooking();
      return clan;
    }).catch(() => undefined);

  /**
   * Testbed convenience, the twin of «Створити клан»: every mock player signs up from
   * localhost, geoip cannot place that IP and main-server stamps them all 'UN'
   * (lib/utils.js), so without this the whole roster wears one identical flag and the flag
   * artwork goes untested.
   *
   * beG.changeFlag is the REAL client RPC — the one the profile screen calls — so this is not a
   * back door: it only accepts free country codes (see TEST_FLAGS) and never a premium flag,
   * which would need `boughtFlags` and answer "not bought". Drawing the flag the player already
   * wears is answered with "Already selected"; that is a miss, not a failure, so it retries with
   * the next code instead of shouting at the tester.
   */
  const changeFlag = () =>
    run('beG.changeFlag (тестовий прапор)', async () => {
      let denied: Error | undefined;
      for (const code of flagsToTry()) {
        try {
          const res = await gw().call('main', 'beG', 'changeFlag', [code]);
          // The flag is copied into the roster by RegisterPlayer, exactly like the clan, so this
          // refresh only redraws the OTHER fields — the new flag shows up in the NEXT lobby.
          await fetchBooking();
          return { flag: code, res };
        } catch (err) {
          if (!/already selected/i.test((err as Error).message)) throw err;
          denied = err as Error;
        }
      }
      throw denied ?? new Error('не вдалося змінити прапор');
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
    setState((st) => ({
      ...st,
      players: Array.isArray(bound?.roster) ? bound.roster : st.players,
      lobbyState: bound?.state ?? st.lobbyState,
      lobbyId: bound?.lobbyId ?? st.lobbyId,
    }));
    return bound;
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
      return res;
    } catch (err) {
      const msg = (err as Error).message;
      pushLog(`survival.getBuyBackQuote ✗ ${msg}`);
      if (!/no method/i.test(msg)) setState((s) => ({ ...s, lastError: errorText(msg) }));
      return undefined;
    }
  }, []);

  // Ask for the price whenever we are inside a window without one — covers a reconnect,
  // a missed event, and a rival's BuyBack that reopened the "too few players" gate.
  useEffect(() => {
    if (state.step !== 'buyback' || !state.buybackOpen) return;
    if (state.buybackCost !== undefined || state.buybackUnavailableReason) return;
    if (status.survival !== 'connected') return;
    void quoteBuyBack();
  }, [
    state.step,
    state.buybackOpen,
    state.buybackCost,
    state.buybackUnavailableReason,
    status.survival,
    quoteBuyBack,
  ]);

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

  const recordAdView = () =>
    run('survival.recordAdView', () => gw().call('survival', 'survival', 'recordAdView', [])).catch(
      () => undefined,
    );

  const lobbyStatus = () =>
    run('survival.getLobbyStatus', async () => {
      const res: any = await gw().call('survival', 'survival', 'getLobbyStatus', []);
      setState((s) => ({
        ...s,
        lobbyState: res?.state,
        lobbyId: res?.lobbyId ?? s.lobbyId,
        players: Array.isArray(res?.roster) ? res.roster : s.players,
      }));
      return res;
    }).catch(() => undefined);

  const secondsLeft = useMemo(() => {
    if (!state.deadline) return null;
    return Math.max(0, Math.round((state.deadline - now) / 1000));
  }, [state.deadline, now]);

  const players = Array.isArray(state.players) ? state.players : [];
  const alive = players.filter((p) => !p.eliminated).length;

  // The chip itself only shows a number; the tooltip says where that number came from,
  // which is the difference between "live" and "stale" while testing.
  const ticketsHint = state.ticketsReason
    ? `остання зміна: ${state.ticketsReason}${
        state.ticketsDelta === undefined
          ? ''
          : ` (${state.ticketsDelta > 0 ? '+' : ''}${state.ticketsDelta})`
      }`
    : 'оновлюється сервером (ticketsUpdated)';

  return (
    <div className="app">
      <header>
        <h1>Survival testbed</h1>
        <div className="pills">
          <span className={`pill ${gwOnline ? 'ok' : 'bad'}`}>gateway</span>
          {TARGETS.map((t) => (
            <span
              key={t}
              className={`pill ${status[t] === 'connected' ? 'ok' : status[t] === 'error' ? 'bad' : ''}`}
              title={
                t === 'main' ? 'акаунт, тікети, вхід у Survival' : 'лоббі, раунди, підрахунок'
              }
            >
              {t}
            </span>
          ))}
        </div>
        <div className="who">
          {session?.playerId ? (
            <>
              <b>вкладка #{session.tabId ?? '?'}</b>
              <code>{String(session.playerId).slice(0, 14)}</code>
            </>
          ) : (
            <i>не залогінений</i>
          )}
          {/* live: the server pushes 'ticketsUpdated' on every balance change, so this
              no longer waits for the «Тікети» button to be clicked */}
          <span className="tickets" title={ticketsHint}>
            🎟 {state.tickets ?? '—'}
          </span>
        </div>
      </header>

      <section className="toolbar">
        <button onClick={startEverything} disabled={!!busy || !gwOnline} className="primary big">
          ▶ Почати тест
        </button>
        <button onClick={connectAll} disabled={!!busy}>Підключити сервери</button>
        <button onClick={() => mockUser(false)} disabled={!!busy || !gwOnline}>Мок-юзер</button>
        <button onClick={() => mockUser(true)} disabled={!!busy || !gwOnline}>Новий гравець</button>
        <button onClick={refreshTickets} disabled={!!busy || !session?.playerId}>Тікети</button>
        <button onClick={grantTickets} disabled={!!busy || !session?.playerId}>+50 🎟</button>
        {/* main-server only: this is the pre-match booking screen, so it must stay usable
            while survival is not connected — do not add a survival gate here */}
        <button onClick={bookingStatus} disabled={!!busy || !session?.playerId}>
          Хто зареєстрований
        </button>
        <button onClick={joinSurvival} disabled={!!busy || !session?.playerId} className="primary">
          Зайти в Survival
        </button>
        <button onClick={lobbyStatus} disabled={!!busy}>Статус лобі</button>
        <button onClick={leaveSurvival} disabled={!!busy || state.step === 'idle'}>Вийти</button>
        <button onClick={recordAdView} disabled={!!busy || state.step === 'idle'}>Реклама +🎟</button>
        <button onClick={() => quoteBuyBack()} disabled={!!busy || state.step === 'idle'}>
          Ціна викупу
        </button>
        {busy && <span className="busy">{busy}…</span>}
      </section>

      <main>
        <div className="stage">
          <div className="stepbar">
            <b>{stepLabel[state.step]}</b>
            {state.round > 0 && <span>раунд {state.round}</span>}
            {state.mode && <span className="mode">{state.mode}</span>}
            {secondsLeft !== null && (
              <span className={`timer ${secondsLeft <= 5 ? 'hot' : ''}`}>{secondsLeft}s</span>
            )}
          </div>

          {survivalLost && state.step !== 'idle' && (
            <div className="error stale">
              <b>Звʼязок із survival-server втрачено.</b> Матч на екрані вже не існує —
              стан бою тримається лише в памʼяті сервера й гине при перезапуску.
              <button className="primary" onClick={startEverything} disabled={!!busy}>
                Зайти заново
              </button>
            </div>
          )}

          {state.lastError && <div className="error">{state.lastError}</div>}

          {state.step === 'idle' && (
            <p className="hint">Натисни «Підключити сервери» → «Мок-юзер» → «Зайти в Survival».</p>
          )}

          {state.step === 'lobby' && (
            <div className="panel">
              <h2>Лобі {state.lobbyId ? String(state.lobbyId).slice(0, 8) : ''}</h2>
              <p>стан: <b>{state.lobbyState ?? '—'}</b></p>
              {state.lobbyState === 'ONBOARDING' && state.onboardingEndsAt ? (
                <>
                  <p className="countdown">
                    старт через {Math.max(0, Math.ceil((state.onboardingEndsAt - now) / 1000))} с
                  </p>
                  <p className="hint">
                    Встигни відкрити ще вкладку й зайти там — потрапите в це саме лоббі.
                    Коли час вийде, вільні місця доберуться ботами.
                  </p>
                </>
              ) : (
                state.scheduledStartAt && (
                  <p>старт: {new Date(state.scheduledStartAt).toLocaleString()}</p>
                )
              )}
              <p>гравців у лоббі: <b>{players.length || '—'}</b></p>
            </div>
          )}

          {state.step === 'starting' && (
            <div className="panel"><h2>Матч стартує…</h2></div>
          )}

          {(state.step === 'question' || state.step === 'spectator') &&
            (state.question ? (
              <QuestionView
                state={state}
                disabled={state.step === 'spectator' || state.myAnswer !== undefined}
                onAnswer={submitAnswer}
              />
            ) : (
              <div className="panel">
                <h2>{state.step === 'spectator' ? 'Ти вибув — дивишся' : 'Раунд іде'}</h2>
                <p className="hint">Питання ще не прийшло від сервера.</p>
              </div>
            ))}

          {state.step === 'results' && <ResultsView state={state} me={playerId} />}

          {state.step === 'buyback' && (
            <BuyBackPanel
              state={state}
              now={now}
              busy={!!busy}
              onBuyBack={buyBack}
              onQuote={quoteBuyBack}
            />
          )}

          {state.step === 'finished' && (
            <div className="panel finish">
              <h2>{state.winnerId === playerId ? '🏆 Перемога!' : 'Матч завершено'}</h2>
              <p>переможець: <code>{state.winnerId ?? '—'}</code></p>
              <p>раундів: {state.totalRounds ?? state.round}</p>
              <button className="primary" onClick={startEverything} disabled={!!busy}>
                Зіграти ще
              </button>
            </div>
          )}
          {/* Below the match panels, and never gated on a step or on the survival socket:
              the booking popup belongs to the main menu, where neither exists yet. */}
          <BookingPanel
            status={booking}
            me={playerId}
            now={now}
            busy={!!busy}
            onRefresh={bookingStatus}
            onMockClan={mockClan}
            onChangeFlag={changeFlag}
          />

          <details className="raw">
            <summary>Стан клієнта (як його бачить UI)</summary>
            <table>
              <tbody>
                <tr><td>крок</td><td>{state.step}</td></tr>
                <tr><td>лоббі</td><td>{state.lobbyId ?? '—'} · {state.lobbyState ?? '—'}</td></tr>
                <tr><td>раунд / режим</td><td>{state.round} · {state.mode ?? '—'}</td></tr>
                <tr><td>питання</td><td>{state.question ? 'є' : 'немає'}</td></tr>
                <tr><td>моя відповідь</td><td>{state.myAnswer === undefined ? '—' : JSON.stringify(state.myAnswer)}</td></tr>
                <tr><td>вибув</td><td>{state.iAmEliminated ? 'так' : 'ні'}</td></tr>
                <tr>
                  <td>тікети</td>
                  <td>
                    {state.tickets ?? '—'}
                    {state.ticketsReason ? ` · ${state.ticketsReason}` : ''}
                    {state.ticketsDelta === undefined
                      ? ''
                      : ` (${state.ticketsDelta > 0 ? '+' : ''}${state.ticketsDelta})`}
                  </td>
                </tr>
                <tr>
                  <td>викуп (приватна ціна)</td>
                  <td>
                    ціна {state.buybackCost ?? '—'} · спроба {state.buybackAttempt ?? '—'}/
                    {state.buybackMaxUses ?? '—'} · по кишені:{' '}
                    {state.buybackAffordable === undefined
                      ? '?'
                      : state.buybackAffordable
                        ? 'так'
                        : 'ні'}
                    {state.buybackUnavailableReason ? ` · ${state.buybackUnavailableReason}` : ''}
                  </td>
                </tr>
                <tr><td>гравців</td><td>{alive} / {players.length}</td></tr>
              </tbody>
            </table>
          </details>
        </div>

        <aside>
          <h3>Гравці ({alive}/{players.length})</h3>
          {/* Same artwork components as the booking roster below — the two lists show the same
              players and must not drift into two different looks. The 🤖/🧑 emoji this replaced
              said nothing the row does not now say better: a bot has no flag, no clan and the
              «бот» tag. */}
          <ul className="players">
            {players.map((p) => (
              <li key={p.playerId} className={p.eliminated ? 'out' : ''}>
                <FlagImg flag={p.flag} />
                <CharacterImg id={p.character} />
                <span className="nick" title={p.playerId}>
                  {p.playerId === playerId ? 'Я' : p.name || String(p.playerId).slice(0, 12)}
                </span>
                <span className="tail">
                  {p.clan && (
                    <span className="clan" title="клан">
                      {p.clan}
                    </span>
                  )}
                  {p.isBot && <span className="bot">бот</span>}
                  {p.ready && !p.eliminated && <span className="ready" title="готовий">✓</span>}
                  {p.eliminated && <em>вибув</em>}
                </span>
              </li>
            ))}
          </ul>

          <h3>Події сервера</h3>
          <ul className="events">
            {events.slice(0, 40).map((e, i) => (
              <li key={i}>
                <b>{e.name}</b>
                <span className="tgt">{e.target}</span>
                <code>{String(JSON.stringify(e.args)).slice(0, 110)}</code>
              </li>
            ))}
          </ul>

          <h3>Лог</h3>
          <ul className="logs">
            {logs.slice(0, 40).map((l, i) => <li key={i}>{l}</li>)}
          </ul>
        </aside>
      </main>
    </div>
  );
}

// ─── roster artwork ───────────────────────────────────────────────────────────
// Two components, used by BOTH player lists (the aside roster and the booking table), so the
// lists cannot drift apart. Neither of them knows how a flag or a character maps to a file —
// that lives in gameAssets.ts and nowhere else.

/**
 * Walk a chain of candidate image URLs, dropping to the next one every time one fails, and end
 * at `null` rather than at a broken image.
 *
 * Running off the end of the chain has to be a real state: an <img> whose last source 404s
 * paints the browser's broken-image glyph, which is a different size from the picture and
 * therefore re-flows the row it sits in. `null` lets the caller keep the box and draw something
 * neutral inside it.
 *
 * The reset is done during render instead of in an effect because these rows are recycled: a
 * roster update reuses the same component instance for a DIFFERENT player, and an effect would
 * leave one frame showing the previous player's picture — and, worse, a failure count that
 * belonged to that player's URLs.
 */
function useImageChain(chain: (string | null)[]): [string | null, () => void] {
  const urls = chain.filter((u): u is string => !!u);
  const key = urls.join('|');
  const [tried, setTried] = useState({ key, failed: 0 });
  if (tried.key !== key) setTried({ key, failed: 0 });
  const failed = tried.key === key ? tried.failed : 0;
  return [urls[failed] ?? null, () => setTried({ key, failed: failed + 1 })];
}

/**
 * The country or premium flag as the game draws it, never as an emoji: main-server stores either
 * an ISO-3166 alpha-2 code or a bought flag's NAME in the very same field, and flagImageUrl is
 * the only thing that knows which is which.
 *
 * An empty flag means a BOT (survival-server's botProfile leaves it ''), and a bot is drawn with
 * no flag at all — the empty box still holds the column so a bot row and a player row line up.
 * A live player is never '': main-server stamps 'UN' when geoip cannot place the sign-up IP.
 * The title is the RAW value on purpose — the point of a testbed is seeing what the server sent.
 */
function FlagImg({ flag }: { flag?: unknown }) {
  const raw = typeof flag === 'string' ? flag.trim() : '';
  const primary = flagImageUrl(raw);
  // The fallback is appended only when there IS a primary: adding it unconditionally would give
  // every bot the white "unknown" flag, which is exactly the flag a bot must not have. It is also
  // dropped when the primary already IS that fallback — flagImageUrl answers unknownFlagUrl for
  // '??' and for anything it fails to recognise — because re-setting a byte-identical src is a
  // no-op for React and the browser: no second error fires and the chain would hang instead of
  // ever reaching its empty state.
  const chain = primary ? (primary === unknownFlagUrl ? [primary] : [primary, unknownFlagUrl]) : [];
  const [src, onError] = useImageChain(chain);
  return (
    <span className="flagbox" title={raw === '' ? 'бот — прапора немає' : raw}>
      {src && <img src={src} alt={raw} onError={onError} loading="lazy" />}
    </span>
  );
}

/**
 * The character portrait: the row icon first, the full-body art as the fallback (the two folders
 * are not in perfect sync — a missing Icon*.png is a case the admin panel hits too), and a
 * neutral chip when neither loads or when the index is not one the game has.
 *
 * All three states are the SAME box, so a 404 never resizes the row. The chip falls back to the
 * raw index, which is what this panel showed before there was any art and is still the most
 * useful thing to read when the picture is the broken part.
 */
function CharacterImg({ id }: { id?: unknown }) {
  const index = typeof id === 'number' && Number.isFinite(id) ? id : undefined;
  const name = characterName(index);
  const [src, onError] = useImageChain([characterIconUrl(index), characterFullUrl(index)]);
  const title = name
    ? `${name} (#${index})`
    : index === undefined
      ? 'персонаж не вказано'
      : `персонаж #${index} — гра такого не має`;
  return (
    <span className="charbox" title={title}>
      {src ? (
        <img src={src} alt={title} onError={onError} loading="lazy" />
      ) : (
        <i>{index ?? '—'}</i>
      )}
    </span>
  );
}

/** 1 гравець · 2 гравці · 5 гравців — this count is the headline, so it has to agree. */
const playersWord = (n: number): string => {
  const tens = n % 100;
  const ones = n % 10;
  if (ones === 1 && tens !== 11) return 'гравець';
  if (ones >= 2 && ones <= 4 && (tens < 12 || tens > 14)) return 'гравці';
  return 'гравців';
};

/**
 * "через 3 год 12 хв". The match is scheduled hours ahead, so seconds are noise until the last
 * minutes; a start that has already passed says so rather than counting backwards.
 */
const untilText = (ms: number): string => {
  if (!Number.isFinite(ms)) return '';
  if (ms <= 0) return 'старт уже настав';
  const total = Math.round(ms / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (hours > 0) return `через ${hours} год ${minutes} хв`;
  if (minutes > 0) return `через ${minutes} хв ${total % 60} с`;
  return `через ${total} с`;
};

/**
 * 1а. Реєстрація — the booking popup exactly as the main menu draws it, long before the match.
 *
 * Everything on it comes from ONE beG.getSurvivalStatus reply, over the main-server connection,
 * with no survival session anywhere: that is the path this panel exists to prove. The roster is
 * rendered in the order it arrived (registration order) and numbered from the array index,
 * because `slot` is null for the whole of BOOKING — sorting it, filtering it or numbering it by
 * slot would all break the contract the server side documents.
 */
function BookingPanel({
  status,
  me,
  now,
  busy,
  onRefresh,
  onMockClan,
  onChangeFlag,
}: {
  status: BookingStatus | null;
  me?: string;
  now: number;
  busy: boolean;
  onRefresh: () => void;
  onMockClan: () => void;
  onChangeFlag: () => void;
}) {
  const lobby = status?.lobby ?? null;
  const roster = lobby?.roster ?? [];
  // playerCount is the server's own total (bots included). The roster length is only a fallback
  // for a reply that did not carry the count — the two agree in every normal answer.
  const total = lobby?.playerCount ?? roster.length;
  const startsAt = lobby?.scheduledStartAt ? Date.parse(lobby.scheduledStartAt) : NaN;

  const registered = status?.registered;
  const regLabel =
    registered === undefined
      ? 'сервер не сказав'
      : registered
        ? '✔ ти зареєстрований'
        : '✖ ти не зареєстрований';

  return (
    <div className="panel booking">
      <div className="head">
        <h2>Реєстрація на матч</h2>
        {status && (
          <span className={`reg ${registered === undefined ? '' : registered ? 'yes' : 'no'}`}>
            {regLabel}
          </span>
        )}
        {status && (
          <span className="fetched">
            beG.getSurvivalStatus · {new Date(status.fetchedAt).toLocaleTimeString()}
          </span>
        )}
      </div>

      {!status ? (
        <p className="hint">
          Натисни «Хто зареєстрований» — це той самий <code>beG.getSurvivalStatus</code>, яким
          головне меню показує список записаних задовго до матчу. Зʼєднання з survival-server
          для цього не потрібне.
        </p>
      ) : status.available === false ? (
        // available:false means survival-server did not answer main-server at all — a different
        // thing from "лоббі ще немає", so it gets its own words instead of an empty list.
        <p className="deny">
          Survival недоступний (<code>available: false</code>) — main-server не достукався до
          survival-server, тож реєстрації зараз немає взагалі.
        </p>
      ) : !lobby ? (
        <p className="deny">
          Активного лоббі немає (<code>lobby: null</code>) — записуватись поки нема куди.
          Наступне лоббі створюється за розкладом.
        </p>
      ) : (
        <>
          <div className="top">
            <div className="count">
              <b>{total}</b> <span>{playersWord(total)} зареєстровано</span>
            </div>
            <div className="meta">
              <span>
                стан: <b>{lobby.state ?? '—'}</b>
              </span>
              {Number.isFinite(startsAt) && (
                <span>
                  старт: <b>{new Date(startsAt).toLocaleString()}</b>
                </span>
              )}
              {lobby.round !== undefined && lobby.round > 0 && (
                <span>
                  раунд: <b>{lobby.round}</b>
                </span>
              )}
              {status.entryCost !== undefined && <span>вхід: 🎟 {status.entryCost}</span>}
            </div>
          </div>

          {Number.isFinite(startsAt) && <p className="until">{untilText(startsAt - now)}</p>}

          {roster.length === 0 ? (
            <p className="hint">Ще ніхто не зареєструвався.</p>
          ) : (
            <div className="rosterbox">
              <div className="rhead">
                <span className="num">№</span>
                <span>прап.</span>
                <span>перс.</span>
                <span>гравець</span>
                <span className="tail">клан</span>
              </div>
              <ol className="roster">
                {roster.map((entry, index) => (
                  <RosterRow
                    // Registration order is the contract, so duplicates must NOT be collapsed:
                    // the index is what keeps the key unique even if the server ever repeats a
                    // playerId, and the row number below comes from that same index.
                    key={`${index}:${entry?.playerId ?? ''}`}
                    entry={entry}
                    index={index}
                    me={me}
                  />
                ))}
              </ol>
            </div>
          )}

          {lobby.activePlayerCount !== undefined && lobby.activePlayerCount !== total && (
            <p className="answered">
              ще в грі: {lobby.activePlayerCount} з {total}
            </p>
          )}
        </>
      )}

      {/* Both are gated on `me` exactly like their toolbar twins: before sign-in main-server's
          beG guard (`if (connection.player)`) never calls back, so an ungated «Оновити список»
          buys the tester a 20 s gateway timeout instead of an error. */}
      <div className="row">
        <button onClick={onRefresh} disabled={busy || !me}>
          Оновити список
        </button>
        <button onClick={onMockClan} disabled={busy || !me}>
          Створити клан
        </button>
        <button onClick={onChangeFlag} disabled={busy || !me}>
          Змінити прапор
        </button>
        <span className="hint small">
          «Створити клан» і «Змінити прапор» — суто тестові кнопки, щоб колонки «клан» і «прап.»
          не були однаковими в усіх рядках (мок-гравці заходять з localhost, тож усім ставиться
          'UN'). Прапор ставиться справжнім <code>beG.changeFlag</code> і тільки безкоштовний.
          І клан, і прапор підставляються в ростер у момент реєстрації, тож тисни їх ДО
          «Зайти в Survival» — інакше зміну буде видно лише в наступному лоббі.
        </span>
      </div>
    </div>
  );
}

/**
 * One booking row: number, flag, character, nickname, clan.
 * Each field is re-checked here rather than trusted: the roster is read straight off the wire
 * (see readBookingStatus, which only guarantees it is an array), so a row that is not an object
 * at all must render as a dash instead of taking the whole panel down with it.
 */
function RosterRow({ entry, index, me }: { entry: LobbyPlayer; index: number; me?: string }) {
  const row: LobbyPlayer = entry && typeof entry === 'object' ? entry : ({} as LobbyPlayer);
  const id = typeof row.playerId === 'string' ? row.playerId : '';
  const name = typeof row.name === 'string' ? row.name.trim() : '';
  // '' is the contracted value for "no clan" (bots always), so an empty column is a real answer
  const clan = typeof row.clan === 'string' ? row.clan.trim() : '';
  const mine = !!me && id === me;

  return (
    <li className={`${mine ? 'me' : ''} ${row.eliminated ? 'out' : ''}`}>
      {/* 1..N from the ARRAY INDEX: `slot` is null for the whole of BOOKING */}
      <span className="num">{index + 1}</span>
      {/* the same two components the aside roster uses — see «roster artwork» above */}
      <FlagImg flag={row.flag} />
      <CharacterImg id={row.character} />
      <span className="nick" title={id}>
        {name || (id ? id.slice(0, 12) : '—')}
      </span>
      <span className="tail">
        {clan && (
          <span className="clan" title="клан">
            {clan}
          </span>
        )}
        {row.isBot && <span className="bot">бот</span>}
        {mine && <span className="mine">я</span>}
      </span>
    </li>
  );
}

/**
 * Everything the player needs before spending tickets: the price of THIS attempt, which
 * attempt it is (the price rises with every one), the balance it will be taken from and
 * how long the window still stands. All of it comes from the private `buyBackOffer` /
 * getBuyBackQuote — never from the broadcast, which knows nothing about this wallet.
 */
function BuyBackPanel({
  state,
  now,
  busy,
  onBuyBack,
  onQuote,
}: {
  state: SurvivalState;
  now: number;
  busy: boolean;
  onBuyBack: () => void;
  onQuote: () => void;
}) {
  const cost = state.buybackCost;
  const blocked = state.buybackUnavailableReason;
  // affordable === undefined means "the server has not said" — let the player try and
  // read the real reason from the denial, instead of guessing a no.
  const cannotAfford = !blocked && state.buybackAffordable === false;
  const closesIn =
    state.buybackClosesAt === undefined
      ? null
      : Math.max(0, Math.ceil((state.buybackClosesAt - now) / 1000));

  const attemptLabel =
    state.buybackAttempt === undefined
      ? null
      : state.buybackMaxUses === undefined
        ? `спроба ${state.buybackAttempt}`
        : `спроба ${state.buybackAttempt} з ${state.buybackMaxUses}`;

  return (
    <div className="panel buyback">
      <h2>Ти вибув — але можеш повернутись</h2>

      <div className="offer">
        {attemptLabel && <span className="attempt">{attemptLabel}</span>}
        <span>твій баланс: 🎟 {state.tickets ?? '—'}</span>
        {closesIn !== null && (
          <span className={closesIn <= 5 ? 'hot' : ''}>вікно закриється через {closesIn} с</span>
        )}
      </div>

      <div className="row">
        <button
          className="primary"
          onClick={onBuyBack}
          disabled={busy || !!blocked || cannotAfford}
        >
          {/* an unknown price gets a neutral label — never a wrong number */}
          {cost === undefined ? 'Викупитись' : `Викупитись — 🎟 ${cost}`}
        </button>
        <button onClick={onQuote} disabled={busy}>Оновити ціну</button>
      </div>

      {blocked ? (
        <p className="deny" title={blocked}>
          {reasonText(blocked)}
        </p>
      ) : cannotAfford ? (
        <p className="deny">
          {reasonText('insufficient_tickets')} — подивись рекламу («Реклама +🎟»), і ціна
          перерахується сама.
        </p>
      ) : cost === undefined ? (
        <p className="hint">Ціну ще не отримано від сервера…</p>
      ) : (
        state.buybackMaxUses !== undefined &&
        state.buybackMaxUses > 1 && (
          <p className="hint">Кожна наступна спроба викупу дорожча за попередню.</p>
        )
      )}
    </div>
  );
}

function QuestionView({
  state,
  disabled,
  onAnswer,
}: {
  state: SurvivalState;
  disabled: boolean;
  onAnswer: (a: unknown) => void;
}) {
  const q = state.question!;
  const [num, setNum] = useState('');
  const [order, setOrder] = useState<number[]>([]);
  const [pin, setPin] = useState<{ lat: number; lng: number } | null>(null);

  useEffect(() => {
    setNum('');
    setOrder([]);
    setPin(null);
  }, [q.id, state.round]);

  return (
    <div className="panel question">
      {disabled && (
        <div className="badge">{state.myAnswer !== undefined ? 'відповідь надіслано' : 'глядач'}</div>
      )}
      <h2>{q.text ?? `Питання (${q.mode})`}</h2>

      {q.mode === 'QUESTION' && (
        <div className="options">
          {(q.options ?? []).map((opt) => (
            <button
              key={opt.id}
              disabled={disabled}
              onClick={() => onAnswer({ type: 'selection', optionId: opt.id })}
            >
              {opt.text}
            </button>
          ))}
        </div>
      )}

      {q.mode === 'MAP' && (
        <div className="map">
          <p className="hint">Клікни по карті — координати підуть на сервер.</p>
          <MapPicker
            pick={pin}
            disabled={disabled}
            onPick={(p) => {
              setPin(p);
              onAnswer({ type: 'map', lat: p.lat, lng: p.lng });
            }}
          />
          {pin && (
            <p className="answered">
              твоя мітка: {pin.lat.toFixed(3)}, {pin.lng.toFixed(3)}
            </p>
          )}
        </div>
      )}

      {q.mode === 'CHRONO' && (
        <div className="chrono">
          <p className="hint">Клікай події в хронологічному порядку — від найранішої.</p>
          {(q.events ?? []).map((ev) => (
            <button
              key={ev.id}
              disabled={disabled || order.includes(ev.id)}
              onClick={() => {
                const next = [...order, ev.id];
                setOrder(next);
                if (next.length === (q.events ?? []).length) onAnswer({ type: 'chrono', order: next });
              }}
            >
              {order.includes(ev.id) ? `${order.indexOf(ev.id) + 1}. ` : ''}
              {ev.text}
            </button>
          ))}
        </div>
      )}

      {q.mode === 'NUMBER' && (
        <div className="number">
          <input
            value={num}
            disabled={disabled}
            onChange={(e) => setNum(e.target.value)}
            placeholder="число"
            type="number"
          />
          <button
            disabled={disabled || num === ''}
            onClick={() => onAnswer({ type: 'number', value: Number(num) })}
          >
            Відповісти
          </button>
        </div>
      )}

      <p className="answered">відповіли: {state.answeredCount}</p>
    </div>
  );
}

function ResultsView({ state, me }: { state: SurvivalState; me?: string }) {
  const correctPoint =
    state.mode === 'MAP' && Array.isArray(state.correctAnswer)
      ? { lat: Number(state.correctAnswer[0]), lng: Number(state.correctAnswer[1]) }
      : null;

  const guesses = state.scores
    .map((sc) => {
      const a = sc.answer as { type?: string; lat?: number; lng?: number } | null;
      if (!a || a.type !== 'map' || typeof a.lat !== 'number') return null;
      return {
        lat: a.lat,
        lng: a.lng as number,
        label: `${sc.playerId === me ? 'Я' : sc.playerId.slice(0, 12)} · ранг ${sc.rank}`,
        mine: sc.playerId === me,
      };
    })
    .filter(Boolean) as { lat: number; lng: number; label: string; mine: boolean }[];

  return (
    <div className="panel results">
      <h2>Результат раунду {state.round}</h2>

      {correctPoint && (
        <div style={{ marginBottom: 14 }}>
          <MapPicker correct={correctPoint} guesses={guesses} disabled height={260} />
          <p className="answered">
            🟢 правильна точка · 🔵 твоя відповідь · 🔴 інші гравці
          </p>
        </div>
      )}

      {state.correctAnswer !== undefined && !correctPoint && (
        <p>правильна відповідь: <code>{JSON.stringify(state.correctAnswer)}</code></p>
      )}
      <table>
        <thead>
          <tr><th>#</th><th>гравець</th><th>відповідь</th><th>очки</th><th /></tr>
        </thead>
        <tbody>
          {[...state.scores].sort((a, b) => a.rank - b.rank).map((s) => (
            <tr key={s.playerId} className={state.eliminated.includes(s.playerId) ? 'out' : ''}>
              <td>{s.rank}</td>
              <td><code>{s.playerId === me ? 'Я' : String(s.playerId).slice(0, 12)}</code></td>
              <td><code>{s.answer === undefined ? '—' : String(JSON.stringify(s.answer)).slice(0, 40)}</code></td>
              <td>{Math.round(s.score * 100) / 100}</td>
              <td>
                {s.correct ? '✅' : '❌'}
                {state.eliminated.includes(s.playerId) ? ' вибув' : ''}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
