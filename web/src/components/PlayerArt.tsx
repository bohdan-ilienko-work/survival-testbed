// ─── roster artwork ───────────────────────────────────────────────────────────
// Two components, used by EVERY player list (the aside roster, the booking table, the endgame
// leaderboard and the header's own portrait), so the lists cannot drift apart. Neither of them
// knows how a flag or a character maps to a file — that lives in gameAssets.ts and nowhere else.
//
// The chain hook below stays module-private: it exists only for these two, and a file that
// exports components and nothing else is also what keeps Fast Refresh working here.

import { useState } from 'react';
import {
  characterFullUrl,
  characterIconUrl,
  characterName,
  flagImageUrl,
  unknownFlagUrl,
} from '../gameAssets';

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
export function FlagImg({ flag }: { flag?: unknown }) {
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
export function CharacterImg({ id }: { id?: unknown }) {
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
