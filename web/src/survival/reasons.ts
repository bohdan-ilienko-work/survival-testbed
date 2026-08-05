// ─── machine reason tags → text the player reads ──────────────────────────────
//
// The tag is the contract and this file is only its Ukrainian face — plus the one verdict that
// is derived from a tag rather than shown (isHardDenial). Its own file because the tables are
// pure lookup: nothing here touches the state, so the reducer can stay about events.

import { asTag } from './guards';

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

export const isHardDenial = (tag?: string): boolean => {
  if (!tag) return false;
  const t = tag.toLowerCase();
  if (HARD_DENIALS.has(t)) return true;
  // the two gate causes are permanent for this window whatever they end up called
  const text = lookupReason(t);
  return text === TOO_FEW_PLAYERS || text === ATTEMPTS_EXHAUSTED;
};
