// Survival mode client state, driven by the events the server actually emits
// (names taken from the code, not the flowchart).

import type { ServerEvent } from './gateway';

export type RoundMode = 'QUESTION' | 'CHRONO' | 'MAP' | 'NUMBER';

/** Flowchart steps, used only to label what the UI is showing. */
export type Step =
  | 'idle'         // not in a lobby
  | 'lobby'        // 1. Лобі
  | 'starting'     // 2. Старт
  | 'question'     // 3-4. Роздача питань / відповідь
  | 'results'      // 5. Показ відповідей
  | 'buyback'      // 8а. BuyBack
  | 'spectator'    // 8б. Вибув
  | 'finished';    // 10. Фінал

export interface LobbyPlayer {
  playerId: string;
  name?: string;
  slot?: number | null;
  isBot?: boolean;
  eliminated?: boolean;
  eliminatedAtRound?: number | null;
  ready?: boolean;
}

/**
 * Some events carry `players` as a COUNT (onboardingStarted) and others as a LIST
 * (fightStarted). Blindly trusting the field once turned state.players into a number
 * and crashed every render that called .filter on it.
 */
const asPlayers = (value: unknown, fallback: LobbyPlayer[]): LobbyPlayer[] =>
  Array.isArray(value) ? (value as LobbyPlayer[]) : fallback;

/**
 * Numeric twin of asPlayers, and for the same reason. The wallet numbers (cost,
 * balance, attempt, closesAt) go straight into comparisons, arithmetic and the label
 * on a button that spends tickets, so a string / null / missing value arriving where
 * `number` is declared must never be stored as-is.
 * `undefined` is deliberately kept as "not known" — it is not the same as 0.
 */
const asNum = (value: unknown, fallback?: number): number | undefined => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : fallback;
  // JSON keeps numbers as numbers, but a payload built by hand can still send "4"
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
};

/** Only a real boolean is a verdict; anything else means "the server did not say". */
const asBool = (value: unknown, fallback?: boolean): boolean | undefined =>
  typeof value === 'boolean' ? value : fallback;

/** Machine reason tags are short non-empty strings; '' and non-strings are no tag. */
const asTag = (value: unknown): string | undefined => {
  const tag = typeof value === 'string' ? value.trim() : '';
  return tag === '' ? undefined : tag;
};

export interface Question {
  id?: string | number;
  mode: RoundMode;
  text?: string;
  /** server sends objects, not plain strings — see SelectionOption in scoring.ts */
  options?: { id: number; text: string }[];
  events?: { id: number; text: string }[];
  imageUrl?: string;
  deadline?: number;
}

export interface Score {
  playerId: string;
  score: number;
  correct: boolean;
  rank: number;
  answer?: unknown;
}

export interface SurvivalState {
  step: Step;
  lobbyId?: string;
  lobbyState?: string;
  scheduledStartAt?: string;
  /** unix ms when on-boarding closes and the fight starts */
  onboardingEndsAt?: number;
  players: LobbyPlayer[];
  round: number;
  mode?: RoundMode;
  question?: Question;
  deadline?: number;
  myAnswer?: unknown;
  answeredCount: number;
  scores: Score[];
  correctAnswer?: unknown;
  eliminated: string[];
  iAmEliminated: boolean;
  buybackOpen: boolean;

  // ─── the private, PER-PLAYER BuyBack offer ('buyBackOffer' / getBuyBackQuote) ───
  // The price indexes THIS player's used attempts, so none of it may ever come from a
  // broadcast. `undefined` everywhere means "the server has not told us yet".
  /** cost of my next attempt in tickets */
  buybackCost?: number;
  /** 1-based number of the attempt the price is for */
  buybackAttempt?: number;
  /** how many attempts a player gets in total (BUYBACK_MAX_USES) */
  buybackMaxUses?: number;
  /** false = the button stays disabled; undefined = unknown, so let the player try */
  buybackAffordable?: boolean;
  /** unix ms when the window really closes, as armed by the server */
  buybackClosesAt?: number;
  /** machine tag — set means "cannot buy back at all right now" */
  buybackUnavailableReason?: string;

  /** authoritative balance, pushed by the server on every change ('ticketsUpdated') */
  tickets?: number;
  /** last pushed change, kept only to make the push visible while testing */
  ticketsDelta?: number;
  ticketsReason?: string;

  winnerId?: string | null;
  totalRounds?: number;
  lastError?: string;
}

export const initialState: SurvivalState = {
  step: 'idle',
  players: [],
  round: 0,
  answeredCount: 0,
  scores: [],
  eliminated: [],
  iAmEliminated: false,
  buybackOpen: false,
};

const asObj = (args: unknown[]): any => (Array.isArray(args) ? args[0] ?? {} : args ?? {});

// ─── machine reason tags → text the player reads ──────────────────────────────

/**
 * Every BuyBack denial arrives as a machine tag: on the private 'buyBackDenied'
 * event, inside 'buyBackOffer'.unavailableReason, and — since the server stopped
 * answering a hardcoded 'BuyBack denied' — as the survival.buyBack RPC error itself.
 * The tag is the contract; this table is only its Ukrainian face, and an unknown tag
 * is always SHOWN rather than swallowed.
 */
const REASON_TEXT: Record<string, string> = {
  insufficient_tickets: 'Не вистачає тікетів на викуп',
  buyback_window_closed: 'Вікно викупу вже закрилося',
  buyback_not_available: 'Викуп зараз недоступний',
  player_not_eliminated: 'Ти ще в грі — викуп не потрібен',
  lobby_not_active: 'Матч уже не активний',
  bots_cannot_buy_back: 'Боти не викуплюються',
  buyback_error: 'Сервер не зміг обробити викуп — спробуй ще раз',
  // transient: a BuyBack of ours is already being charged (a double click). A retry works,
  // so it must stay OUT of HARD_DENIALS below.
  buyback_in_progress: 'Викуп уже виконується — зачекай секунду',
  not_registered: 'Тебе немає в цьому матчі',
  // kept as an alias only: the lobby now spells this cause 'not_registered' everywhere,
  // on the private event and in the RPC error alike
  unknown_player: 'Тебе немає в цьому матчі',
  wallet_unavailable: 'Гаманець недоступний — спробуй ще раз',
  ad_limit_reached: 'Ліміт рекламних тікетів вичерпано',
  // gate: BUYBACK_MIN_PLAYERS_REQUIRED — too few players left for a revive
  buyback_too_few_players: 'Залишилося замало гравців — викуп уже неможливий',
  // gate: BUYBACK_MAX_USES — this player has spent every attempt
  buyback_attempts_exhausted: 'Ти вже використав усі спроби викупу',
};

const TOO_FEW_PLAYERS = REASON_TEXT.buyback_too_few_players;
const ATTEMPTS_EXHAUSTED = REASON_TEXT.buyback_attempts_exhausted;

/**
 * The two gate tags above are new on the server and their exact spelling lives there,
 * so match by shape as well as by name: a rename must not silently downgrade a real
 * message to a raw tag. Everything else is matched exactly.
 */
const lookupReason = (tag: string): string | undefined => {
  const t = tag.toLowerCase();
  const exact = REASON_TEXT[t];
  if (exact) return exact;
  if (/player/.test(t) && /few|min|enough|remain/.test(t)) return TOO_FEW_PLAYERS;
  if (/exhaust|max_uses|no_attempts|out_of_attempts|attempts_left|attempt_limit/.test(t)) {
    return ATTEMPTS_EXHAUSTED;
  }
  return undefined;
};

/** Human text for a denial tag. An unknown tag is surfaced verbatim, on purpose. */
export function reasonText(reason?: unknown): string | undefined {
  const tag = asTag(reason);
  if (!tag) return undefined;
  return lookupReason(tag) ?? `Невідома причина: ${tag}`;
}

/** Same, plus the raw tag — for the error line and the log, where the tag is evidence. */
export function reasonWithTag(reason?: unknown): string {
  const tag = asTag(reason);
  if (!tag) return 'причина невідома';
  const text = lookupReason(tag);
  return text ? `${text} (${tag})` : `невідомий код: ${tag}`;
}

/**
 * RPC failures reach the UI as a bare string (the gateway rejects with
 * error.description). survival.buyBack now answers with the machine tag itself, so a
 * tag-shaped message gets translated while real prose ('Not authenticated') is left
 * exactly as the server wrote it.
 */
export function errorText(message?: unknown): string {
  const raw = typeof message === 'string' ? message.trim() : '';
  if (!raw) return 'Невідома помилка';
  if (!/^[a-z][a-z0-9_]{2,63}$/.test(raw)) return raw;
  const text = lookupReason(raw);
  return text ? `${text} (${raw})` : raw;
}

/** Denials that cannot change while this window is open — the button must go dead. */
const HARD_DENIALS = new Set([
  'buyback_window_closed',
  'buyback_not_available',
  'player_not_eliminated',
  'lobby_not_active',
  'bots_cannot_buy_back',
  'not_registered',
  'unknown_player',
]);

const isHardDenial = (tag?: string): boolean => {
  if (!tag) return false;
  const t = tag.toLowerCase();
  if (HARD_DENIALS.has(t)) return true;
  // the two gate causes are permanent for this window whatever they end up called
  const text = lookupReason(t);
  return text === TOO_FEW_PLAYERS || text === ATTEMPTS_EXHAUSTED;
};

// ─── the BuyBack offer ────────────────────────────────────────────────────────

type OfferFields = Pick<
  SurvivalState,
  | 'buybackCost'
  | 'buybackAttempt'
  | 'buybackMaxUses'
  | 'buybackAffordable'
  | 'buybackClosesAt'
  | 'buybackUnavailableReason'
>;

/**
 * Nothing about one window may survive into the next: a price from round 4 shown next
 * to a live button in round 6 would be a lie about how many tickets the click spends.
 */
const NO_OFFER: OfferFields = {
  buybackCost: undefined,
  buybackAttempt: undefined,
  buybackMaxUses: undefined,
  buybackAffordable: undefined,
  buybackClosesAt: undefined,
  buybackUnavailableReason: undefined,
};

/** undefined = unknown, so never claim the player cannot pay. */
const canAfford = (cost?: number, balance?: number): boolean | undefined =>
  cost === undefined || balance === undefined ? undefined : balance >= cost;

/**
 * Read the price fields out of a 'buyBackOffer' payload or a getBuyBackQuote reply —
 * the two carry the same fields, so they are parsed in one place to stop them drifting.
 */
const readOffer = (p: any, prevTickets?: number): OfferFields & { tickets?: number } => {
  const cost = asNum(p.cost);
  const stated = asNum(p.balance);
  const balance = stated ?? prevTickets;
  // `cost: null` means "cannot buy back at all" and is contracted to arrive with a
  // reason; if the reason is missing we still refuse rather than offering a button
  // with no price. A payload with no `cost` KEY at all is merely unknown, not a no.
  const costStated = !!p && typeof p === 'object' && 'cost' in p;
  const unavailableReason =
    asTag(p.unavailableReason) ??
    (costStated && cost === undefined ? 'buyback_not_available' : undefined);
  return {
    buybackCost: cost,
    buybackAttempt: asNum(p.attempt),
    buybackMaxUses: asNum(p.maxUses),
    buybackClosesAt: asNum(p.closesAt),
    buybackUnavailableReason: unavailableReason,
    // trust the server's verdict when it really sent one, else derive it
    buybackAffordable: unavailableReason ? false : asBool(p.affordable, canAfford(cost, balance)),
    // 'ticketsUpdated' is the authority for this number and says so in its own case below. The
    // quoted balance is read from the server's per-match cache, which does not learn about a
    // movement made outside survival-server (main-server's free daily ticket, an IAP, a direct
    // grant), so letting it win would roll a freshly pushed balance BACKWARDS. It is used only
    // to seed the chip when nothing has been pushed yet.
    tickets: prevTickets ?? stated,
  };
};

/**
 * Apply a survival.getBuyBackQuote reply. Same fields as the offer minus round and
 * closesAt, so an existing countdown is kept.
 */
export function applyBuyBackQuote(state: SurvivalState, quote: unknown): SurvivalState {
  if (!quote || typeof quote !== 'object') return state;
  const offer = readOffer(quote, state.tickets);
  return { ...state, ...offer, buybackClosesAt: offer.buybackClosesAt ?? state.buybackClosesAt };
}

/**
 * Apply a new balance and re-derive what it changes.
 *
 * The single place a balance is written, so every source goes through the same re-derivation:
 * the 'ticketsUpdated' push below, and equally a balance learned some other way — beG.getTickets
 * (which also grants the free daily ticket) or a direct grant on main-server. Neither of those
 * passes through survival-server, so neither produces a push; assigning `tickets` raw for them
 * left `buybackAffordable` on its old `false` and the priced Викупитись button dead for the rest
 * of the window, right next to a chip showing enough tickets to pay.
 *
 * A non-numeric or null balance keeps the previous value rather than blanking the chip — the
 * server's balance is legitimately nullable once a finished lobby drops its ticket record.
 */
export function applyTicketBalance(
  state: SurvivalState,
  balance: unknown,
  meta: { delta?: unknown; reason?: unknown } = {},
): SurvivalState {
  const tickets = asNum(balance, state.tickets);
  return {
    ...state,
    tickets,
    ticketsDelta: asNum(meta.delta),
    ticketsReason: asTag(meta.reason),
    // a fresh balance can make an already-quoted price affordable (ad reward, top-up) or not;
    // an unavailable offer stays unavailable whatever the balance says
    buybackAffordable: state.buybackUnavailableReason
      ? false
      : canAfford(state.buybackCost, tickets) ?? state.buybackAffordable,
  };
}

/**
 * Reduce a server event into the survival state.
 * Event names mirror survival-server/src/lobby/lobby.ts and fight/survivalFight.ts.
 */
export function reduce(state: SurvivalState, ev: ServerEvent, myPlayerId?: string): SurvivalState {
  const p = asObj(ev.args);

  switch (ev.name) {
    case 'playerJoined':
    case 'playerLeft':
      return {
        ...state,
        step: state.step === 'idle' ? 'lobby' : state.step,
        players: asPlayers(p.roster ?? p.players, state.players),
      };

    case 'rosterUpdate':
      return {
        ...state,
        step: state.step === 'idle' ? 'lobby' : state.step,
        lobbyId: p.lobbyId ?? state.lobbyId,
        lobbyState: p.state ?? state.lobbyState,
        players: asPlayers(p.roster, state.players),
      };

    case 'onboardingStarted':
      return {
        ...state,
        step: 'lobby',
        lobbyState: 'ONBOARDING',
        onboardingEndsAt: p.durationMs ? Date.now() + p.durationMs : undefined,
        players: asPlayers(p.roster, state.players),
      };

    case 'fightStarted':
      return {
        ...state,
        step: 'starting',
        lobbyState: 'ACTIVE',
        onboardingEndsAt: undefined,
        players: asPlayers(p.roster ?? p.players, state.players),
      };

    case 'roundStarted':
      return {
        ...state,
        // a new round means the previous window (and its price) is history
        ...NO_OFFER,
        step: state.iAmEliminated ? 'spectator' : 'question',
        round: p.round ?? state.round,
        mode: p.mode,
        question: { ...(p.question ?? {}), mode: p.mode, deadline: p.deadline },
        deadline: p.deadline,
        myAnswer: undefined,
        answeredCount: 0,
        scores: [],
        correctAnswer: undefined,
        eliminated: [],
        buybackOpen: false,
      };

    case 'answerReceived':
      return { ...state, answeredCount: state.answeredCount + 1 };

    case 'roundResult': {
      const eliminated: string[] = p.eliminated ?? [];
      const iAmOut = myPlayerId ? eliminated.includes(myPlayerId) : false;
      return {
        ...state,
        step: 'results',
        scores: p.scores ?? [],
        correctAnswer: p.correctAnswer,
        eliminated,
        iAmEliminated: state.iAmEliminated || iAmOut,
      };
    }

    case 'tiebreakStarted':
      return {
        ...state,
        step: 'question',
        mode: 'NUMBER',
        question: { ...(p.question ?? {}), mode: 'NUMBER', deadline: p.question?.deadline },
        deadline: p.question?.deadline,
        myAnswer: undefined,
      };

    case 'tiebreakResult':
      return { ...state, step: 'results', scores: p.scores ?? state.scores };

    case 'playerEliminated': {
      const iAmOut = myPlayerId === p.playerId;
      return {
        ...state,
        iAmEliminated: state.iAmEliminated || iAmOut,
        players: state.players.map((pl) =>
          pl.playerId === p.playerId ? { ...pl, eliminated: true } : pl,
        ),
      };
    }

    // Broadcast, and deliberately carries no wallet data: the price comes from the
    // private 'buyBackOffer' instead. It must NOT clear the offer — the two events are
    // emitted together and their order is not guaranteed, so clearing here could wipe
    // a price that already arrived. `roundStarted` is what separates two windows.
    case 'buybackWindowOpen':
      return {
        ...state,
        step: state.iAmEliminated ? 'buyback' : state.step,
        buybackOpen: true,
      };

    case 'buybackWindowClosed':
      return {
        ...state,
        ...NO_OFFER,
        buybackOpen: false,
        step: state.iAmEliminated ? 'spectator' : state.step,
      };

    case 'buyBackSuccess': {
      const mine = myPlayerId === p.playerId;
      // Somebody ELSE coming back does not close my window — it only makes the roster
      // bigger, which can loosen the "too few players left" gate. Drop the stale offer
      // so the UI re-quotes instead of keeping a verdict that may no longer hold.
      const dropOffer = mine || state.buybackOpen;
      return {
        ...state,
        ...(dropOffer ? NO_OFFER : {}),
        buybackOpen: mine ? false : state.buybackOpen,
        iAmEliminated: mine ? false : state.iAmEliminated,
        step: mine ? 'question' : state.step,
        // never read a balance out of an event addressed to another player
        tickets: mine ? asNum(p.balance, state.tickets) : state.tickets,
        players: state.players.map((pl) =>
          pl.playerId === p.playerId ? { ...pl, eliminated: false } : pl,
        ),
      };
    }

    case 'buyBackDenied': {
      // Private wallet event. The server addresses it to one socket; ignoring a
      // mis-addressed payload turns a server-side privacy bug into a no-op instead of
      // showing this player somebody else's denial.
      if (myPlayerId && p.playerId && p.playerId !== myPlayerId) return state;
      const tag = asTag(p.reason);
      return {
        ...state,
        lastError: `Викуп відхилено: ${reasonWithTag(tag)}`,
        // a permanent denial must also kill the button for the rest of the window
        buybackUnavailableReason: isHardDenial(tag) ? tag : state.buybackUnavailableReason,
        // not enough tickets can be fixed by an ad, so keep it recoverable
        buybackAffordable: tag === 'insufficient_tickets' ? false : state.buybackAffordable,
      };
    }

    case 'ticketsUpdated': {
      if (myPlayerId && p.playerId && p.playerId !== myPlayerId) return state;
      // Authoritative: the server pushes on every real balance change, so this wins over
      // whatever an RPC reply left behind.
      return applyTicketBalance(state, p.balance ?? p.tickets, { delta: p.delta, reason: p.reason });
    }

    // Private, PER-PLAYER: the price indexes THIS player's used attempts, so a payload
    // addressed to anybody else must not be rendered as mine.
    case 'buyBackOffer': {
      if (myPlayerId && p.playerId && p.playerId !== myPlayerId) return state;
      return {
        ...state,
        ...readOffer(p, state.tickets),
        // the offer can arrive before the broadcast, so it opens the panel on its own
        buybackOpen: true,
        step: state.iAmEliminated ? 'buyback' : state.step,
      };
    }

    case 'playerKickedAfterDisconnect':
      return {
        ...state,
        players: state.players.map((pl) =>
          pl.playerId === p.playerId ? { ...pl, eliminated: true } : pl,
        ),
      };

    case 'fightFinished':
    case 'lobbyFinished':
      return {
        ...state,
        ...NO_OFFER,
        buybackOpen: false,
        step: 'finished',
        winnerId: p.winnerId ?? null,
        totalRounds: p.totalRounds ?? state.round,
      };

    case 'lobbyCancelled':
      return { ...state, step: 'idle', lastError: 'Lobby cancelled' };

    case 'fightError':
      return { ...state, lastError: `Fight error: ${p.reason ?? 'unknown'}` };

    default:
      return state;
  }
}

export const stepLabel: Record<Step, string> = {
  idle: '— поза лобі',
  lobby: '1. Лобі',
  starting: '2. Старт матчу',
  question: '3-4. Питання / відповідь',
  results: '5. Показ відповідей',
  buyback: '8а. BuyBack',
  spectator: '8б. Вибув — режим глядача',
  finished: '10. Фінал',
};
