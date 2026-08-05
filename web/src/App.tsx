import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { DragEvent, ReactNode } from 'react';
import { Gateway, type ServerEvent, type Target, type TargetState } from './gateway';
import {
  applyBuyBackQuote,
  applyTicketBalance,
  errorText,
  initialState,
  reasonText,
  readBookingStatus,
  readOnboardingClosesAt,
  reduce,
  stepLabel,
  type BookingStatus,
  type LobbyPlayer,
  type RewardRow,
  type SurvivalState,
} from './survival';
import { MapPicker } from './MapPicker';
import { Modal } from './ui/Modal';
import { CharacterEditor } from './ui/CharacterEditor';
import {
  characterFullUrl,
  characterIconUrl,
  characterName,
  flagImageUrl,
  unknownFlagUrl,
} from './gameAssets';
import './App.css';
import './ui/shell.css';

const TARGETS: Target[] = ['main', 'survival'];

/**
 * Which dialog is up, at most one at a time.
 *
 * They are all different ways of looking at the SAME player, so stacking two would only ever
 * hide the thing underneath — and the match itself is never one of them: everything that IS the
 * fight (question, results, buyback, the lobby countdown) stays on the stage, because a dialog
 * over a running round is a dialog over a ticking deadline.
 */
type Dialog = 'booking' | 'lobby' | 'quote' | 'character';

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
interface Profile {
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

  // ─── dialogs ───────────────────────────────────────────────────────────────
  const [dialog, setDialog] = useState<Dialog | null>(null);
  /**
   * The last failure raised by a dialog's OWN buttons. It needs somewhere separate to land:
   * run() writes failures into the stage's error box, and the stage is behind the backdrop
   * while a dialog is up — so without this a button inside a modal looks like it did nothing.
   */
  const [dialogError, setDialogError] = useState<string | null>(null);
  // Read by quoteBuyBack, which is also fired by an effect during a match: a price it failed to
  // fetch on its own must not be reported inside whatever OTHER dialog happens to be open.
  const dialogRef = useRef<Dialog | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  // The raw replies the two read-only dialogs exist to show. Kept out of SurvivalState for the
  // same reason `booking` is: they are snapshots of one call, not the live match.
  const [lobbyInfo, setLobbyInfo] = useState<{ at: number; reply: unknown } | null>(null);
  const [quoteInfo, setQuoteInfo] = useState<{ at: number; reply: unknown } | null>(null);

  dialogRef.current = dialog;

  const playerId: string | undefined = session?.playerId;
  const playerIdRef = useRef<string | undefined>(undefined);
  playerIdRef.current = playerId;

  const pushLog = (line: string) =>
    setLogs((l) => [`${new Date().toLocaleTimeString()} · ${line}`, ...l].slice(0, 200));

  const gw = () => gwRef.current!;

  /**
   * Re-read the player's live character / flag / name.
   *
   * beG.getContext is the very call the real client's main menu makes, and `userContext` is
   * where main-server publishes those fields — see the Profile type above for why no cheaper
   * source exists.
   *
   * Not wrapped in run() on purpose, exactly like fetchBooking: callers refresh from INSIDE
   * their own run(), and a nested run()'s finally would clear `busy` while the outer call is
   * still in flight.
   */
  const fetchProfile = useCallback(async () => {
    const res: any = await gw().call('main', 'beG', 'getContext', []);
    const u = res?.userContext;
    if (!u || typeof u !== 'object') return undefined;
    // Read guarded, like survival.ts reads the wire: a renamed or missing field has to degrade
    // into "не знаю" instead of putting an undefined-driven picture on screen.
    setProfile({
      character: typeof u.character === 'number' ? u.character : undefined,
      flag: typeof u.flag === 'string' ? u.flag : undefined,
      name: typeof u.name === 'string' ? u.name : undefined,
      // published right beside character/flag (lib/contexts.js) — see Profile.reborn
      reborn: typeof u.reborn === 'boolean' ? u.reborn : undefined,
    });
    return u;
  }, []);

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
        // The header portrait and the editor's «зараз» both read this. A miss is not a failed
        // sign-in, so it must not fall into the catch below and claim the login broke.
        await fetchProfile().catch((e) => pushLog(`beG.getContext ✗ ${(e as Error).message}`));
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
    // fetchProfile is a useCallback with no dependencies, so its identity never changes and
    // listing it cannot re-run this effect — which it must not, since re-running would tear the
    // gateway socket down and re-create it under a live match.
  }, [fetchProfile]);

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

  /**
   * run(), plus the failure lands INSIDE the open dialog.
   *
   * Used by every button that lives in a modal. It swallows the rejection the same way the
   * toolbar's `.catch(() => undefined)` does — the message is already on screen, in the log and
   * in the stage's error box, so re-throwing it would only add an unhandled rejection.
   */
  const runInDialog = (label: string, fn: () => Promise<unknown>) => {
    setDialogError(null);
    return run(label, fn).catch((err) => {
      setDialogError((err as Error).message);
      return undefined;
    });
  };

  // A dialog always opens on a clean slate: the previous dialog's refusal is not this one's.
  const openDialog = (which: Dialog) => {
    setDialogError(null);
    setDialog(which);
  };
  const closeDialog = () => setDialog(null);

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
      setLobbyInfo(null);
      setQuoteInfo(null);
      // Same for the look: every mock account is signed up with its own character (the gateway
      // rotates them), so keeping the old one would draw the previous player's portrait in the
      // header and preselect it in the editor.
      setProfile(null);
      await fetchProfile().catch(() => undefined);
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

  // Lives in the booking dialog now (its refresh button), so its failure has to show up there.
  const bookingStatus = () => runInDialog('beG.getSurvivalStatus', fetchBooking);

  /**
   * Testbed convenience, not a product feature: fresh mock accounts are clanless, so without
   * this the roster's clan column is empty on every row and the new field goes untested.
   * The clan NAME is copied into the roster row when RegisterPlayer runs and is never
   * refreshed afterwards, so a clan created after «Зайти в Survival» only shows up in the
   * NEXT lobby — hence the hint next to the button.
   */
  const mockClan = () =>
    runInDialog('mockClan (тестовий клан)', async () => {
      const clan = await gw().mockClan();
      await fetchBooking();
      return clan;
    });

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
    runInDialog('beG.changeFlag (тестовий прапор)', async () => {
      let denied: Error | undefined;
      for (const code of flagsToTry()) {
        try {
          const res = await gw().call('main', 'beG', 'changeFlag', [code]);
          // The header's flag reads the live profile, so it is the one place the change shows
          // up immediately; the roster right under this button cannot, for the reason on the
          // next line.
          setProfile((p) => ({ ...(p ?? {}), flag: code }));
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
    });

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

  // After the final: survival-server only REPORTS the result (ProcessSurvivalResult) and
  // main-server pays in its own time, so a balance read at the moment of 'lobbyFinished' is
  // read BEFORE the payout lands. Ask again after a short pause — through the same
  // beG.getTickets path the «Тікети» button uses — and quietly: an automatic refresh that
  // misses is a log line, not an error to shout over the endgame screen.
  useEffect(() => {
    if (state.step !== 'finished') return;
    const t = setTimeout(async () => {
      try {
        const res: any = await gw().call('main', 'beG', 'getTickets', []);
        pushLog(`beG.getTickets (після виплати) → ${String(JSON.stringify(res)).slice(0, 120)}`);
        setState((s) => applyTicketBalance(s, res?.tickets ?? res, { reason: 'payout' }));
      } catch (err) {
        pushLog(`beG.getTickets (після виплати) ✗ ${(err as Error).message}`);
      }
    }, 2500);
    return () => clearTimeout(t);
    // deliberately only the step: re-arming on every state change would keep pushing the
    // payout read further into the future while events keep arriving
  }, [state.step]);

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

  // ─── character & flag editor (beG.resetChar / beG.changeFlag / adminApi.grantToPlayer) ───
  // All three go through run() so a refusal reaches the editor as a rejection carrying the
  // server's own words — the editor prints error.message verbatim and adds a hint of its own
  // only for the refusals it recognises.

  /**
   * beG.resetChar. ONE positional argument, the {character, categories} object
   * (main-server api/beG/resetChar.js), and `categories` is ordered [strong, strong, weak] —
   * resetChar reads categories.slice(0,2) as the strong pair and [2] as the weak one, so it must
   * not be sorted or de-duplicated on the way out.
   */
  const applyCharacter = async ({
    character,
    categories,
  }: {
    character: number;
    categories: string[];
  }) => {
    await run('beG.resetChar', async () => {
      const res: any = await gw().call('main', 'beG', 'resetChar', [{ character, categories }]);
      // The reply carries the character the server actually stored, so adopt THAT rather than
      // what we asked for — and do it before the refresh below, so «зараз» moves even if the
      // refresh is refused.
      setProfile((p) => ({
        ...(p ?? {}),
        character: typeof res?.character === 'number' ? res.character : character,
      }));
      // The booking roster has a character column, so it is worth redrawing — but its rows are
      // stamped at RegisterPlayer time, so what actually changes there is the NEXT lobby's rows.
      // A failure here is not a refused reset, so it must never reject this promise: the editor
      // would print the refresh's message as if the character change had been denied.
      await fetchBooking().catch(() => undefined);
      return res;
    });
  };

  /** beG.changeFlag — one positional argument, the code or premium flag NAME. */
  const applyFlag = async (flag: string) => {
    await run(`beG.changeFlag ${flag}`, async () => {
      const res: any = await gw().call('main', 'beG', 'changeFlag', [flag]);
      setProfile((p) => ({ ...(p ?? {}), flag: typeof res?.flag === 'string' ? res.flag : flag }));
      await fetchBooking().catch(() => undefined);
      return res;
    });
  };

  /**
   * adminApi.grantToPlayer — the testbed shortcut that makes a premium character or flag
   * selectable at all. The editor never sends a playerId (it has no business knowing one), so it
   * is added here, together with the audit `reason` main-server writes into moneyFlow.
   */
  const grantToPlayer = async (payload: {
    characters?: number[];
    flags?: string[];
    experience?: number;
    gems?: number;
  }) => {
    await run('adminApi.grantToPlayer', async () => {
      const res = await gw().call('main', 'adminApi', 'grantToPlayer', [
        { playerId, ...payload, reason: 'testbed' },
      ]);
      // A grant moves ownership and the wallet, neither of which is drawn on this screen — but
      // main-server itself treats the client as stale afterwards (it pushes `runMain` to force a
      // context refetch), so take it at its word rather than guess that nothing changed.
      await fetchProfile().catch(() => undefined);
      return res;
    });
  };

  // ─── openers ───────────────────────────────────────────────────────────────
  // Each of the three read-only dialogs asks its own question on the way up, so opening one is
  // one click rather than "open, then press refresh".

  const openBooking = () => {
    openDialog('booking');
    void bookingStatus();
  };

  const openLobbyStatus = () => {
    openDialog('lobby');
    void lobbyStatus();
  };

  const openQuote = () => {
    openDialog('quote');
    void quoteBuyBack();
  };

  const openCharacterEditor = () => {
    openDialog('character');
    // Refresh what the editor calls «зараз»: without it the editor falls back to the roster's
    // registration-time copy, which is exactly the value a previous edit already invalidated.
    // A miss only means that fallback stays — the reason is in the log.
    void run('beG.getContext', fetchProfile).catch(() => undefined);
  };

  /** The price dialog's own refresh: quoteBuyBack never rejects, it reports through dialogError. */
  const refreshQuote = () => {
    setDialogError(null);
    void quoteBuyBack();
  };

  const secondsLeft = useMemo(() => {
    if (!state.deadline) return null;
    return Math.max(0, Math.round((state.deadline - now) / 1000));
  }, [state.deadline, now]);

  const players = Array.isArray(state.players) ? state.players : [];
  const alive = players.filter((p) => !p.eliminated).length;

  /**
   * My own row, wherever the server last mentioned me: the booking list first (it is the
   * pre-match screen and exists hours earlier), the live lobby roster second.
   *
   * It is only ever a FALLBACK for the editor — see Profile — because both rosters carry the
   * character and flag copied in at registration, not the current ones.
   */
  const myRosterRow = useMemo(() => {
    if (!playerId) return undefined;
    const booked = booking?.lobby?.roster?.find((r) => r?.playerId === playerId);
    if (booked) return booked;
    // state.players and not the `players` above: that one re-creates its [] fallback on every
    // render, which would make this memo re-run every render and defeat the point of it.
    const live = Array.isArray(state.players) ? state.players : [];
    return live.find((p) => p?.playerId === playerId);
  }, [booking, state.players, playerId]);

  /** What the editor opens on: the live profile where we have it, the roster copy otherwise. */
  const myLook = useMemo(
    () => ({
      playerId,
      character:
        profile?.character ??
        (typeof myRosterRow?.character === 'number' ? myRosterRow.character : undefined),
      flag: profile?.flag ?? (typeof myRosterRow?.flag === 'string' ? myRosterRow.flag : undefined),
      name: profile?.name ?? (typeof myRosterRow?.name === 'string' ? myRosterRow.name : undefined),
      // only beG.getContext knows this — the roster row carries no such field
      reborn: profile?.reborn,
    }),
    [profile, myRosterRow, playerId],
  );

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
              {/* The live look (beG.getContext), and the only place on screen that can show it:
                  every roster row still carries the picture stamped in at registration, so this
                  is the one thing that moves the moment the editor changes a character. */}
              {profile && (profile.character !== undefined || !!profile.flag) && (
                <span className="look" title="персонаж і прапор гравця зараз (beG.getContext)">
                  {profile.character !== undefined && <CharacterImg id={profile.character} />}
                  {!!profile.flag && <FlagImg flag={profile.flag} />}
                </span>
              )}
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

      {/* Four intents instead of one undifferentiated row. Every `disabled` below is unchanged
          from the flat row it replaces: each one encodes a real precondition (note that «Хто
          зареєстрований» is deliberately NOT gated on the survival socket), so the grouping is a
          layout change and not a permission change. */}
      <section className="toolbar">
        <ToolGroup label="Стенд">
          <button onClick={startEverything} disabled={!!busy || !gwOnline} className="primary big">
            ▶ Почати тест
          </button>
          <button onClick={connectAll} disabled={!!busy}>Підключити сервери</button>
        </ToolGroup>

        <ToolGroup label="Гравець">
          <button onClick={() => mockUser(false)} disabled={!!busy || !gwOnline}>Мок-юзер</button>
          <button onClick={() => mockUser(true)} disabled={!!busy || !gwOnline}>Новий гравець</button>
          {/* Gated on the player, not on the gateway: every call the editor makes goes to
              main-server's beG/adminApi, and beG's guard (`if (connection.player)`) simply never
              calls back for a tab that has not signed in — a 20 s timeout instead of an error. */}
          <button onClick={openCharacterEditor} disabled={!!busy || !session?.playerId}>
            Персонаж
          </button>
          <button onClick={grantTickets} disabled={!!busy || !session?.playerId}>+50 🎟</button>
          <button onClick={refreshTickets} disabled={!!busy || !session?.playerId}>Тікети</button>
        </ToolGroup>

        <ToolGroup label="Survival">
          {/* main-server only: this is the pre-match booking screen, so it must stay usable
              while survival is not connected — do not add a survival gate here */}
          <button onClick={openBooking} disabled={!!busy || !session?.playerId}>
            Хто зареєстрований
          </button>
          <button onClick={joinSurvival} disabled={!!busy || !session?.playerId} className="primary">
            Зайти в Survival
          </button>
          <button onClick={openLobbyStatus} disabled={!!busy}>Статус лобі</button>
          <button onClick={leaveSurvival} disabled={!!busy || state.step === 'idle'}>Вийти</button>
        </ToolGroup>

        <ToolGroup label="У бою">
          <button onClick={recordAdView} disabled={!!busy || state.step === 'idle'}>
            Реклама +🎟
          </button>
          <button onClick={openQuote} disabled={!!busy || state.step === 'idle'}>
            Ціна викупу
          </button>
        </ToolGroup>

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
            <FinishView state={state} me={playerId} busy={!!busy} onRestart={startEverything} />
          )}
          {/* The booking screen used to sit here, permanently, under the match panels. It is a
              MAIN-MENU popup — it exists hours before there is a step or a survival socket — so
              it now opens as a dialog («Хто зареєстрований»), and the stage is left to the
              things that are the match itself. */}

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
                <tr>
                  <td>нагороди (фінал)</td>
                  <td>
                    {state.rewards === undefined
                      ? 'не знаю — сервер не прислав'
                      : `${state.rewards.length} рядків`}
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

      {/* ─── dialogs ──────────────────────────────────────────────────────────────
          Everything here is something you LOOK UP or CHANGE about yourself, never something
          you do during a round: the match panels stay on the stage, where a running timer is
          visible and nothing has to be dismissed to answer a question. */}

      <Modal
        open={dialog === 'booking'}
        onClose={closeDialog}
        size="lg"
        busy={!!busy}
        title="Реєстрація на матч"
        subtitle={
          booking ? (
            <>
              <span
                className={`ui-chip ${
                  booking.registered === undefined ? '' : booking.registered ? 'ok' : 'warn'
                }`}
              >
                {booking.registered === undefined
                  ? 'сервер не сказав'
                  : booking.registered
                    ? '✔ ти зареєстрований'
                    : '✖ ти не зареєстрований'}
              </span>{' '}
              beG.getSurvivalStatus · {new Date(booking.fetchedAt).toLocaleTimeString()}
            </>
          ) : (
            'beG.getSurvivalStatus — той самий список, який головне меню показує задовго до матчу'
          )
        }
        footer={
          <>
            {/* The dialog's own failures live in the footer, next to the buttons that raised
                them and always in view — the body scrolls, and a refusal that scrolled away is
                a button that looks like it did nothing. */}
            {dialogError && <span className="spread ui-note bad">{dialogError}</span>}
            {/* Every one of these is gated on `me` exactly like its toolbar twin: before sign-in
                main-server's beG guard never calls back, so an ungated button buys the tester a
                20 s gateway timeout instead of an error. */}
            <button onClick={bookingStatus} disabled={!!busy || !playerId}>Оновити список</button>
            <button onClick={mockClan} disabled={!!busy || !playerId}>Створити клан</button>
            <button onClick={changeFlag} disabled={!!busy || !playerId}>Змінити прапор</button>
            <button onClick={openCharacterEditor} disabled={!!busy || !playerId}>Персонаж…</button>
            <button className="primary" onClick={closeDialog} disabled={!!busy}>Закрити</button>
          </>
        }
      >
        <BookingBody status={booking} me={playerId} now={now} />
      </Modal>

      <Modal
        open={dialog === 'lobby'}
        onClose={closeDialog}
        busy={!!busy}
        title="Статус лобі"
        subtitle={
          lobbyInfo
            ? `survival.getLobbyStatus · ${new Date(lobbyInfo.at).toLocaleTimeString()}`
            : 'survival.getLobbyStatus — питаємо survival-server напряму'
        }
        footer={
          <>
            {dialogError && <span className="spread ui-note bad">{dialogError}</span>}
            <button onClick={lobbyStatus} disabled={!!busy}>Оновити</button>
            <button className="primary" onClick={closeDialog} disabled={!!busy}>Закрити</button>
          </>
        }
      >
        <div className="ui-stack">
          <div className="ui-rows">
            <div className="ui-row"><span>лоббі</span><span><code>{state.lobbyId ?? '—'}</code></span></div>
            <div className="ui-row"><span>стан</span><span>{state.lobbyState ?? '—'}</span></div>
            <div className="ui-row"><span>крок клієнта</span><span>{stepLabel[state.step]}</span></div>
            <div className="ui-row"><span>у ростері</span><span>{players.length || '—'}</span></div>
            <div className="ui-row"><span>ще в грі</span><span>{alive}</span></div>
          </div>
          {/* The roster the reply carries is already adopted into state.players, so it is drawn
              by the aside on the right; repeating it here would be two lists that can disagree. */}
          {lobbyInfo ? (
            <div>
              <h3 className="ui-h">Відповідь сервера</h3>
              <RawJson value={lobbyInfo.reply} />
            </div>
          ) : (
            /* survival-server checks `connectedClients.get(connection)` and then boundLobby()
               (server.ts:832), so this call needs a socket already bound by survival.connect —
               say so instead of letting the tester read "Not authenticated" as a bug. */
            <p className="ui-sub">
              Ще не питали. Виклик іде прямо в survival-server і працює тільки для привʼязаного
              зʼєднання: без «Зайти в Survival» сервер відповість <code>Not authenticated</code>.
            </p>
          )}
        </div>
      </Modal>

      <Modal
        open={dialog === 'quote'}
        onClose={closeDialog}
        busy={!!busy}
        title="Ціна викупу"
        subtitle={
          quoteInfo
            ? `survival.getBuyBackQuote · ${new Date(quoteInfo.at).toLocaleTimeString()}`
            : 'survival.getBuyBackQuote — приватна ціна саме для цього гравця'
        }
        footer={
          <>
            {dialogError && <span className="spread ui-note bad">{dialogError}</span>}
            <button onClick={refreshQuote} disabled={!!busy}>Оновити ціну</button>
            <button className="primary" onClick={closeDialog} disabled={!!busy}>Закрити</button>
          </>
        }
      >
        <div className="ui-stack">
          <div className="ui-rows">
            <div className="ui-row">
              <span>ціна цієї спроби</span>
              <span>{state.buybackCost === undefined ? '—' : `🎟 ${state.buybackCost}`}</span>
            </div>
            <div className="ui-row">
              <span>спроба</span>
              <span>
                {state.buybackAttempt ?? '—'} / {state.buybackMaxUses ?? '—'}
              </span>
            </div>
            <div className="ui-row"><span>твій баланс</span><span>🎟 {state.tickets ?? '—'}</span></div>
            <div className="ui-row">
              <span>по кишені</span>
              <span>
                {state.buybackAffordable === undefined
                  ? 'сервер не сказав'
                  : state.buybackAffordable
                    ? 'так'
                    : 'ні'}
              </span>
            </div>
            <div className="ui-row">
              <span>вікно закриється</span>
              <span>
                {state.buybackClosesAt === undefined
                  ? '—'
                  : `через ${Math.max(0, Math.ceil((state.buybackClosesAt - now) / 1000))} с`}
              </span>
            </div>
            {state.buybackUnavailableReason && (
              <div className="ui-row">
                <span>недоступно</span>
                <span title={state.buybackUnavailableReason}>
                  {reasonText(state.buybackUnavailableReason)}
                </span>
              </div>
            )}
          </div>
          {/* Викуп сам по собі лишився на сцені — це частина бою і не ховається в діалог. */}
          <p className="ui-note">
            Ціна приватна: сервер шле її подією <b>buyBackOffer</b> у момент відкриття вікна, а
            цей виклик — спосіб дізнатись її, якщо вкладка перепідключилась і подію проґавила.
            Сама кнопка «Викупитись» лишається на сцені, у панелі бою.
          </p>
          {quoteInfo && (
            <div>
              <h3 className="ui-h">Відповідь сервера</h3>
              <RawJson value={quoteInfo.reply} />
            </div>
          )}
        </div>
      </Modal>

      {/* The one dialog that WRITES. All three of its calls go through run(), so a refusal comes
          back as a rejection carrying main-server's own wording, which is what the editor puts
          on screen. */}
      <CharacterEditor
        open={dialog === 'character'}
        onClose={closeDialog}
        current={myLook}
        busy={busy}
        onApplyCharacter={applyCharacter}
        onApplyFlag={applyFlag}
        onGrant={grantToPlayer}
      />
    </div>
  );
}

/**
 * One labelled cluster of toolbar buttons.
 *
 * The caption is the point: it says what the buttons under it are FOR, which is the one thing
 * the old flat row could not say. `role="group"` + aria-labelledby gives a screen reader the
 * same grouping the eye gets, instead of a dozen unrelated buttons in a row.
 */
function ToolGroup({ label, children }: { label: string; children: ReactNode }) {
  const id = useId();
  return (
    // These class names belong to App.css, which owns the whole toolbar block — including the
    // ≤720px rule that drops each group onto its own line. Renaming them here unstyles all of it
    // silently, which is exactly what happened while this file and the stylesheet were written
    // in parallel.
    <div className="tgroup" role="group" aria-labelledby={id}>
      <span className="tgroup-label" id={id}>
        {label}
      </span>
      <div className="tgroup-buttons">{children}</div>
    </div>
  );
}

/**
 * A server reply, untouched.
 *
 * The whole reason a testbed exists is to see what actually came back, so the dialogs that ask
 * a question show the raw JSON next to the fields the UI read out of it — that is how a renamed
 * field is caught instead of silently rendering as «—».
 */
function RawJson({ value }: { value: unknown }) {
  return (
    <div className="ui-scroll-x">
      <pre className="raw-json">
        <code>{JSON.stringify(value, null, 2)}</code>
      </pre>
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
 *
 * It is the BODY of a dialog now, not a panel on the stage: no frame of its own (the dialog is
 * the frame), no title and no «зареєстрований» pill (both live in the modal header), and no
 * button row (those are the modal footer, pinned under the scroll so a long roster cannot push
 * them out of reach).
 */
function BookingBody({
  status,
  me,
  now,
}: {
  status: BookingStatus | null;
  me?: string;
  now: number;
}) {
  const lobby = status?.lobby ?? null;
  const roster = lobby?.roster ?? [];
  // playerCount is the server's own total (bots included). The roster length is only a fallback
  // for a reply that did not carry the count — the two agree in every normal answer.
  const total = lobby?.playerCount ?? roster.length;
  const startsAt = lobby?.scheduledStartAt ? Date.parse(lobby.scheduledStartAt) : NaN;

  return (
    <div className="booking in-modal">
      {!status ? (
        <p className="hint">
          Це той самий <code>beG.getSurvivalStatus</code>, яким головне меню показує список
          записаних задовго до матчу. Зʼєднання з survival-server для цього не потрібне —
          натисни «Оновити список» унизу.
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

      <p className="ui-note warn">
        «Створити клан», «Змінити прапор» і «Персонаж…» унизу — суто тестові кнопки, щоб колонки
        «клан», «прап.» і «перс.» не були однаковими в усіх рядках (мок-гравці заходять з
        localhost, тож геоip ставить усім 'UN'). Прапор ставиться справжнім{' '}
        <code>beG.changeFlag</code>, персонаж — справжнім <code>beG.resetChar</code>.
        <b> Клан, прапор і персонаж підставляються в ростер у момент реєстрації</b>, тож міняй їх
        ДО «Зайти в Survival» — інакше зміну буде видно лише в наступному лоббі.
      </p>
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
  /**
   * CHRONO is a MATCHING round: pairs[i] = index into q.years for events[i], -1 = not paired.
   * Kept here rather than inside ChronoPairing so it is cleared by the same effect as every
   * other draft answer — a pairing left over from the previous round would be submitted
   * against a completely different set of facts.
   */
  const [pairs, setPairs] = useState<number[]>([]);
  const [pin, setPin] = useState<{ lat: number; lng: number } | null>(null);

  useEffect(() => {
    setNum('');
    setPairs([]);
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
        <ChronoPairing
          events={q.events ?? []}
          years={q.years ?? []}
          pairs={pairs}
          disabled={disabled}
          onPairs={setPairs}
          onAnswer={onAnswer}
        />
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

/** A fact can be a whole sentence; a tooltip that quotes one has to stay one line. */
const clip = (text: string, max = 48) =>
  text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;

/**
 * CHRONO — the MATCHING round: pair every event with the year it happened.
 *
 * The wire is `{ type: 'chrono', pairs }`, where pairs[i] is the index into `years` chosen for
 * events[i] and -1 means "not paired". The server validates that (fight-server facts.ts,
 * isValidFactsAnswer): same length as the events, every value in [-1, years.length), and NO
 * duplicate non-(-1) value — one year belongs to exactly one event. So the UI is built so a
 * duplicate cannot even be expressed:
 *
 *  - dropping a year another event already holds SWAPS the two rows (that other event takes
 *    whatever this one held, possibly nothing). A steal would silently unpair a row further up
 *    the list, and refusing the drop would force clear-then-assign for what is nearly always
 *    meant as "these two are the wrong way round";
 *  - dragging a year back into «вільні роки» un-pairs it, because -1 is a legal value and a
 *    testbed has to be able to send it.
 *
 * Every gesture — drop, click, Enter on a focused chip — goes through the SAME assign(). The
 * swap rule is a server invariant, so a second implementation of it is a second thing that can
 * drift out of agreement with the validator.
 *
 * DRAG IS NOT THE ONLY PATH, deliberately: the per-row year strip stays clickable and behaves
 * exactly as it did before dragging existed. HTML5 drag-and-drop has no keyboard gesture at all
 * and is unreliable under touch emulation, and this panel is the one place a tester works
 * AGAINST A RUNNING ROUND DEADLINE — a gesture that does not take is a round lost, not an
 * inconvenience. So every year stays reachable with Tab + Enter on every row.
 */
function ChronoPairing({
  events,
  years,
  pairs,
  disabled,
  onPairs,
  onAnswer,
}: {
  events: { id: number; text: string }[];
  years: number[];
  pairs: number[];
  disabled: boolean;
  onPairs: (pairs: number[]) => void;
  onAnswer: (a: unknown) => void;
}) {
  // The draft starts as [] (that is also what a new round resets it to), so a missing slot reads
  // as "not paired yet" instead of undefined leaking into the answer.
  const yearOf = (i: number) => pairs[i] ?? -1;
  /** which event currently holds year `yi`, -1 = nobody */
  const holderOf = (yi: number) => events.findIndex((_, i) => yearOf(i) === yi);

  const assign = (i: number, yi: number) => {
    // Rebuilt at full length every time: the answer must be exactly as long as the event list,
    // whatever the draft happened to be sparse at.
    const next = events.map((_, k) => yearOf(k));
    const held = next[i];
    if (held === yi) {
      next[i] = -1;
      onPairs(next);
      return;
    }
    const other = next.findIndex((v, k) => k !== i && v === yi);
    if (other >= 0) next[other] = held;
    next[i] = yi;
    onPairs(next);
  };

  /**
   * Dropped back into the pool. Routed through assign()'s own toggle rather than writing -1
   * here: that keeps the "one year, one event" bookkeeping in a single function.
   */
  const unpair = (yi: number) => {
    const holder = holderOf(yi);
    if (holder >= 0) assign(holder, yi);
  };

  /** the chip in flight; `key` says WHICH copy of that year it is, so only that one dims */
  const [drag, setDrag] = useState<{ yi: number; key: string } | null>(null);
  /** the drop target under the pointer — an event index, or the un-pair pool */
  const [over, setOver] = useState<number | 'pool' | null>(null);
  /**
   * The same year index, in a ref, because the FIRST dragover can reach a target before React
   * has re-rendered with the state — and a dragover that skips preventDefault is a target that
   * silently refuses the drop.
   */
  const dragged = useRef<number | null>(null);

  const endDrag = () => {
    dragged.current = null;
    setDrag(null);
    setOver(null);
  };

  const dragProps = (yi: number, key: string) => ({
    draggable: !disabled,
    onDragStart: (e: DragEvent) => {
      e.dataTransfer.effectAllowed = 'move';
      // Firefox starts no drag at all unless something is written here, so this is required
      // even though the ref below is what the drop actually reads first.
      e.dataTransfer.setData('text/plain', String(yi));
      dragged.current = yi;
      setDrag({ yi, key });
    },
    // Fires after EVERY drag, including one released over nothing — which is exactly why the
    // pairing is only ever written in onDrop: a drop outside a target must change nothing.
    onDragEnd: endDrag,
  });

  /** The year a drop is carrying, re-checked against the CURRENT strip before it is used. */
  const droppedYear = (e: DragEvent): number | null => {
    const raw = e.dataTransfer.getData('text/plain');
    const yi = raw === '' ? dragged.current ?? -1 : Number(raw);
    // an index from a strip that no longer exists (the round changed mid-drag) would be exactly
    // the out-of-range value isValidFactsAnswer rejects
    return Number.isInteger(yi) && yi >= 0 && yi < years.length ? yi : null;
  };

  const dropProps = (target: number | 'pool') => ({
    onDragOver: (e: DragEvent) => {
      // preventDefault is what MAKES a drop legal, so it is spent only on our own chips: a file
      // or a text selection dragged in from outside must go on being refused by the browser.
      if (disabled || dragged.current === null) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (over !== target) setOver(target);
    },
    onDragLeave: (e: DragEvent) => {
      // dragleave also fires when the pointer crosses from the row onto a chip INSIDE it, so the
      // highlight is dropped only when the pointer really left the target — otherwise it blinks
      // off and on again over every chip.
      if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
      setOver((t) => (t === target ? null : t));
    },
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      const yi = droppedYear(e);
      if (yi !== null) {
        if (target === 'pool') unpair(yi);
        // Dropping a year back on the row that already holds it is a no-op, not an un-pair.
        // assign() treats a repeat as the toggle — right for a CLICK, wrong for a drag, where
        // "put it back where I picked it up" must mean "cancel", never "remove it". The pool
        // is the un-pair target, and dragging out to it still works.
        else if (holderOf(yi) !== target) assign(target, yi);
      }
      endDrag();
    },
  });

  // `years` missing — an older server, or a value the wire guard refused — is not a crash: the
  // events still render so the tester sees what DID arrive, there is just nothing to pair with.
  const noYears = years.length === 0;
  const paired = events.reduce((n, _, i) => (yearOf(i) === -1 ? n : n + 1), 0);
  /** years nobody holds — the pool's contents, and the only list that shrinks as pairs are made */
  const free = years.map((_, yi) => yi).filter((yi) => holderOf(yi) === -1);

  return (
    <div className="chrono">
      <p className="hint">
        {noYears
          ? 'Сервер не надіслав масив years — пару скласти нема з чого.'
          : 'Перетягни рік на подію. Один рік — тільки для однієї події: кидок на зайняту подію' +
            ' міняє їх місцями, а перетягування року назад у «вільні роки» знімає пару.'}
      </p>
      {!noYears && (
        <p className="hint small">
          Клік по року в рядку робить те саме — саме він працює з клавіатури (Tab + Enter) і на
          тачскріні, де перетягування ненадійне.
        </p>
      )}

      {!noYears && (
        <div className={`pair-pool${over === 'pool' ? ' over' : ''}`} {...dropProps('pool')}>
          <span className="pair-pool-label">вільні роки</span>
          {free.length === 0 ? (
            <span className="pair-pool-empty">
              усі роки розібрано — перетягни рік сюди, щоб зняти пару
            </span>
          ) : (
            free.map((yi) => (
              // A span, not a button: a click here has no row to aim at, so there is nothing for
              // it to do. Nothing is lost — every year is also a real button in every row below,
              // which is where the keyboard path lives.
              <span
                key={yi}
                // `off`, not :disabled — a span never matches that pseudo-class, so once the
                // round closes these chips would keep hovering and reading as live while
                // dragProps has already stopped them being draggable.
                className={`pair-year free${disabled ? ' off' : ''}${
                  drag?.key === `pool:${yi}` ? ' dragging' : ''
                }`}
                title={disabled ? undefined : 'вільний рік — перетягни його на подію'}
                {...dragProps(yi, `pool:${yi}`)}
              >
                {years[yi]}
              </span>
            ))
          )}
        </div>
      )}

      {events.map((ev, i) => {
        const mine = yearOf(i);
        return (
          <div className={`pair-row${over === i ? ' over' : ''}`} key={ev.id} {...dropProps(i)}>
            <div className="pair-event">
              {/* The row's own year is a chip too, so it can be dragged straight onto another row
                  (a swap) or back into the pool (un-pair) without hunting for it in a strip. */}
              <span
                className={`pair-slot${mine === -1 ? '' : ' set'}${
                  drag?.key === `slot:${i}` ? ' dragging' : ''
                }`}
                title={
                  mine === -1
                    ? undefined
                    : 'перетягни на іншу подію або у «вільні роки», щоб зняти пару'
                }
                {...(mine === -1 || disabled ? {} : dragProps(mine, `slot:${i}`))}
              >
                {mine === -1 ? '—' : years[mine]}
              </span>
              <span className="pair-text">{ev.text}</span>
            </div>
            {!noYears && (
              <div className="pair-years">
                {years.map((year, yi) => {
                  const holder = holderOf(yi);
                  const isMine = holder === i;
                  return (
                    <button
                      key={yi}
                      className={`pair-year${isMine ? ' on' : holder >= 0 ? ' taken' : ''}${
                        drag?.key === `${i}:${yi}` ? ' dragging' : ''
                      }`}
                      // Only the round being closed kills a chip. A chip taken by another event
                      // stays clickable ON PURPOSE — that click IS the swap.
                      disabled={disabled}
                      // The rows carry no visible numbers, so a taken chip names the event
                      // holding it by its TEXT — «зайнятий подією 2» would be unresolvable.
                      title={
                        isMine
                          ? 'зняти пару'
                          : holder >= 0
                            ? `зайнятий: «${clip(events[holder].text)}» — клік поміняє їх місцями`
                            : undefined
                      }
                      onClick={() => assign(i, yi)}
                      {...dragProps(yi, `${i}:${yi}`)}
                    >
                      {year}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}

      {/* An EXPLICIT submit, unlike the sequence UI this replaced (which fired the moment every
          event had been clicked). A pairing stays editable to the last second — one drop can
          swap two rows — so the first instant every slot happens to be full is not the instant
          the tester means to send, and the server takes one answer per round. Left enabled while
          the pairing is incomplete because -1 is a legal value and that path needs testing too. */}
      <button
        className="primary pair-submit"
        disabled={disabled || noYears}
        onClick={() => onAnswer({ type: 'chrono', pairs: events.map((_, i) => yearOf(i)) })}
      >
        Відповісти — {paired} з {events.length}
      </button>
      {!noYears && paired < events.length && (
        <p className="hint">Непаровані події підуть як -1 — сервер таку відповідь приймає.</p>
      )}
    </div>
  );
}

// ─── 10. Фінал: підсумкова таблиця з нагородами ───────────────────────────────

/** One line of the endgame table: a roster row joined with its payout, if it got one. */
interface FinishRow {
  playerId: string;
  /** the OVERALL final rank (bots consume ranks too) */
  rank?: number;
  /** true = the rank was reconstructed client-side, not stated by the server */
  approx: boolean;
  name?: string;
  flag?: string;
  character?: number;
  isBot?: boolean;
  eliminated?: boolean;
  eliminatedAtRound?: number | null;
  gems: number;
  tickets: number;
}

/**
 * Join the final roster with the payout rows into one ranked table.
 *
 * The wire states ranks only for PAID humans — bots consume ranks but are omitted, and so are
 * all-zero rows — so most bots (and humans below the paid ranks) arrive rankless. Rather than
 * dropping them, the unclaimed ranks are handed out from what the client watched happen: the
 * winner first, then survivors, then the later-eliminated over the earlier. Every such rank is
 * MARKED as reconstructed — a testbed must never pass a client guess off as a server fact.
 */
function buildFinishRows(
  players: LobbyPlayer[],
  rewards: RewardRow[] | undefined,
  winnerId?: string | null,
): FinishRow[] {
  // first payout row per player wins; a duplicate playerId in `rewards` is a server bug the
  // raw event log already shows, and doubling money on screen would compound it
  const paid = new Map<string, RewardRow>();
  for (const r of rewards ?? []) if (!paid.has(r.playerId)) paid.set(r.playerId, r);

  const rows: FinishRow[] = players.map((p) => {
    const r = paid.get(p.playerId);
    return {
      playerId: p.playerId,
      rank: r?.rank,
      approx: false,
      name: p.name,
      flag: p.flag,
      character: p.character,
      isBot: p.isBot,
      eliminated: p.eliminated,
      eliminatedAtRound: p.eliminatedAtRound,
      gems: r?.gems ?? 0,
      tickets: r?.tickets ?? 0,
    };
  });

  // a payout addressed to somebody the roster forgot still has to be visible — it is money
  const known = new Set(rows.map((row) => row.playerId));
  for (const r of paid.values()) {
    if (known.has(r.playerId)) continue;
    known.add(r.playerId);
    rows.push({
      playerId: r.playerId,
      rank: r.rank,
      approx: false,
      gems: r.gems ?? 0,
      tickets: r.tickets ?? 0,
    });
  }

  // the ranks the server did not claim, in order — these go to the rankless rows below
  const taken = new Set<number>();
  for (const row of rows) if (row.rank !== undefined) taken.add(row.rank);
  const free: number[] = [];
  for (let n = 1; n <= rows.length; n++) if (!taken.has(n)) free.push(n);

  // roster order is the final tiebreak, so two bots eliminated in one round stay stable
  const order = new Map(rows.map((row, i) => [row, i] as [FinishRow, number]));
  const outcome = (row: FinishRow): number => {
    if (winnerId && row.playerId === winnerId) return Number.MAX_SAFE_INTEGER;
    if (!row.eliminated) return Number.MAX_SAFE_INTEGER - 1; // survived to the final round
    // later elimination = better place; an unknown round sorts below every known one
    return typeof row.eliminatedAtRound === 'number' ? row.eliminatedAtRound : -1;
  };
  const unranked = rows
    .filter((row) => row.rank === undefined)
    .sort((a, b) => outcome(b) - outcome(a) || order.get(a)! - order.get(b)!);
  unranked.forEach((row, i) => {
    // more rankless players than free ranks (duplicate server ranks): '—' beats a wrong number
    if (free[i] === undefined) return;
    row.rank = free[i];
    row.approx = true;
  });

  return rows.sort(
    (a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity) || order.get(a)! - order.get(b)!,
  );
}

/**
 * 10. Фінал — the endgame leaderboard the game mockup draws: rank, flag + portrait + nickname,
 * then the payout. It reuses the booking roster's grid and artwork (.rosterbox / FlagImg /
 * CharacterImg) so the pre-match list and the final table keep one look.
 */
function FinishView({
  state,
  me,
  busy,
  onRestart,
}: {
  state: SurvivalState;
  me?: string;
  busy: boolean;
  onRestart: () => void;
}) {
  const players = Array.isArray(state.players) ? state.players : [];
  const rows = buildFinishRows(players, state.rewards, state.winnerId);
  const anyApprox = rows.some((r) => r.approx);

  return (
    <div className="panel finish">
      <h2>{me && state.winnerId === me ? '🏆 Перемога!' : 'Матч завершено'}</h2>
      <p>
        переможець: <code>{state.winnerId ?? '—'}</code> · раундів:{' '}
        {state.totalRounds ?? state.round}
      </p>

      {state.rewards === undefined ? (
        // an old survival-server sends no rewards at all — that is "не знаю", not "нуль"
        <p className="hint">
          Нагороди: не знаю — сервер не прислав <code>rewards</code> (старий survival-server?).
        </p>
      ) : (
        state.rewards.length === 0 && (
          <p className="hint">
            Сервер відповів порожнім <code>rewards</code> — виплат у цьому матчі немає.
          </p>
        )
      )}

      {rows.length > 0 && (
        <div className="rosterbox">
          <div className="rhead">
            <span className="num">#</span>
            <span>прап.</span>
            <span>перс.</span>
            <span>гравець</span>
            <span className="tail">нагорода</span>
          </div>
          <ol className="roster">
            {rows.map((row, index) => (
              <FinishRowView
                // index keeps the key unique even if the server ever repeats a playerId
                key={`${index}:${row.playerId}`}
                row={row}
                mine={!!me && row.playerId === me}
                win={!!state.winnerId && row.playerId === state.winnerId}
              />
            ))}
          </ol>
        </div>
      )}

      <p className="hint small">
        Боти займають місця в рейтингу, але нагород не отримують — сервер платить лише людям.
        {anyApprox &&
          ' Ранги курсивом відновлено з порядку вибування: сервер шле ранг лише тим, кому платить.'}
      </p>
      {/* the payout is asynchronous — the delayed beG.getTickets effect in App() re-reads it */}
      <p className="hint small">Баланс 🎟 оновлюється після виплати на main-server.</p>

      <button className="primary" onClick={onRestart} disabled={busy}>
        Зіграти ще
      </button>
    </div>
  );
}

/** One endgame row. Zero reward parts are omitted; a row with neither is an unpaid rank. */
function FinishRowView({ row, mine, win }: { row: FinishRow; mine: boolean; win: boolean }) {
  // bots are never paid — a bot row carrying money is a server bug, and the raw event log on
  // the right is where that evidence belongs, not a leaderboard cell that legitimises it
  const gems = !row.isBot && row.gems > 0 ? row.gems : 0;
  const tickets = !row.isBot && row.tickets > 0 ? row.tickets : 0;
  return (
    <li className={`${mine ? 'me' : ''} ${win ? 'win' : ''}`}>
      <span
        className={`num ${row.approx ? 'approx' : ''}`}
        title={
          row.approx
            ? 'ранг відновлено клієнтом з порядку вибування'
            : row.rank === undefined
              ? 'ранг невідомий'
              : 'фінальний ранг від сервера'
        }
      >
        {row.rank ?? '—'}
      </span>
      <FlagImg flag={row.flag} />
      <CharacterImg id={row.character} />
      <span className="nick" title={row.playerId}>
        {row.name || row.playerId.slice(0, 12)}
      </span>
      <span className="tail">
        {row.isBot && <span className="bot">бот</span>}
        {mine && <span className="mine">я</span>}
        {gems > 0 && <span className="reward gems">💎 {gems}</span>}
        {tickets > 0 && <span className="reward tix">🎟 {tickets}</span>}
      </span>
    </li>
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
