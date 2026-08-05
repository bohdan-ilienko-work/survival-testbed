// What main-server refuses in this flow, and the exact amounts the testbed grants to get past it.
//
// The two halves are one idea: every grant on this screen exists to answer one of the refusals
// below (not enough level → +досвід, notEnoughGems → +кристалів), and the hint for that refusal
// names the amount. Splitting them would put a number and the sentence quoting it in two files.
//
// Read out of main-server on branch SurvivalMode (2026-08-05); the file/line is named at each
// claim so the next reader can re-check instead of trusting a comment.

/**
 * Grant sizes for the adminApi shortcut.
 *
 * EXPERIENCE: 5000 puts a fresh account at level ~30 on the base curve (lib/experience.js
 * xpToNextLevel is cumulative 4810 at level 30 and 5290 at 31), comfortably past any plausible
 * value of the level gate resetChar checks. That gate is `api.beGenius.changeCharLevel`, which on
 * this branch is READ (lib/characters.js:294) and never assigned anywhere in the repo — so it is
 * undefined, the comparison is NaN and the gate currently lets everyone through. The button stays
 * because a config that does set it must not turn this editor into a dead end.
 *
 * GEMS: charReset costs 50 gems (files/additionalPrices.json → "CharReset": Amount 50,
 * Currency 1 = GEMS, lib/money.js:4) and only the FIRST reset is free, so 500 buys ten more
 * character swaps — enough to walk the whole gallery in one session.
 */
export const GRANT_EXPERIENCE = 5000;
export const GRANT_GEMS = 500;

/**
 * Plain-language reading of the refusals main-server actually produces here. The raw message is
 * ALWAYS shown next to this — the hint explains, it never replaces, and an error with no hint is
 * still shown in full rather than swallowed.
 *
 * The gateway turns an application error into `error.description` or, when there is none, into the
 * JSON of the error object (gateway/index.js:189) — that is why notEnoughGems, which carries only
 * `code: 302` (lib/errors.js:50), is matched as a number.
 */
export const errorHint = (raw: string): string | null => {
  const m = raw.toLowerCase();
  if (m.includes('not enough level'))
    return 'Замало рівня для зміни персонажа — тисни «+досвід» і спробуй ще раз.';
  if (m.includes('skin is unavailable'))
    return 'Персонаж не куплений — тисни «Видати цього персонажа» і повтори.';
  if (m.includes('player is busy'))
    return 'Гравець у матчмейкінгу або в паті — вийди звідти, resetChar цього не дозволяє.';
  if (m.includes('wrong character index'))
    return 'Сервер не дає цього персонажа цьому гравцеві: реборн-персонаж вимагає пройденого реборну, а базовий — навпаки, його відсутності.';
  if (m.includes('302') || m.includes('notenoughgems'))
    return `Не вистачає кристалів: перший скид безкоштовний, кожен наступний коштує 50. Тисни «+${GRANT_GEMS} кристалів».`;
  if (m.includes('categories'))
    return 'Сервер не прийняв категорії — має бути рівно 3 різні зі списку (для реборн-гравця — 2).';
  if (m.includes('not bought'))
    return 'Преміум-прапор не куплений — тисни «Видати всі преміум-прапори» і повтори.';
  if (m.includes('already selected')) return 'Цей прапор уже стоїть на гравцеві — вибери інший.';
  if (m.includes('wrong flag name'))
    return 'Сервер не знає такого прапора — код має бути з api.beGenius.flags.all.';
  return null;
};
