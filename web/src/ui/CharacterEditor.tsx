// Character & flag editor — the testbed's way of putting DIFFERENT artwork on the player, so a
// roster row can be looked at with more than the one character every mock account starts on.
//
// It is presentational + composition only: it never imports the gateway and knows nothing about
// JSTP or WebSockets. The three callbacks are the whole contract, and they map 1:1 onto the three
// server calls the flow really needs — beG.resetChar, beG.changeFlag and adminApi.grantToPlayer.
//
// The shapes (.ui-tile, .ui-grid, .ui-picks, .ui-note, .ui-seg …) come from ui.css, which Modal
// already imports; characterEditor.css only adds what is genuinely this screen's own — the
// gallery/preview split, the big portrait and the strong/strong/weak category slots.
//
// Everything this file claims about the server was read out of main-server on branch SurvivalMode
// (2026-08-05); the file/line is named at each claim so the next reader can re-check instead of
// trusting a comment.

import { useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { Modal } from './Modal';
import {
  CHARACTER_COUNT,
  PREMIUM_FLAGS,
  characterFullUrl,
  characterIconUrl,
  characterName,
  flagImageUrl,
  unknownFlagUrl,
} from '../gameAssets';
import './characterEditor.css';

// ─── ground truth copied from main-server ────────────────────────────────────

/**
 * `api.beGenius.orderCategories` — lib/other.js:29. resetChar refuses anything outside this list,
 * and it does so through `api.beGenius.error.commonError` (lib/characters.js:331), which is a typo
 * for `errors` and therefore THROWS instead of answering. A bad category payload gets no readable
 * refusal at all, which is why this editor validates the selection itself before it calls.
 */
const CATEGORIES = [
  { id: 'history', label: 'Історія' },
  { id: 'geography', label: 'Географія' },
  { id: 'art', label: 'Мистецтво' },
  { id: 'sport', label: 'Спорт' },
  { id: 'science', label: 'Наука' },
];

type CharacterKind = 'basic' | 'reborn' | 'premium';

/**
 * Which of the 29 characters resetChar will accept, and the strong categories the GAME gives each
 * one. Transcribed from main-server/applications/beGenius/lib/characters.js (basicCharacters /
 * rebornCharacters / premiumCharacters, read 2026-08-05) — the type drives the "will the server
 * take it?" verdict, the categories preload the picker.
 *
 * Premium entries carry no strongCategories in the server table at all (they are sold on a
 * bonusSkill instead), so they preload nothing and the tester picks freely.
 */
const CHARACTER_META: Record<number, { kind: CharacterKind; strong: string[] }> = {
  0: { kind: 'basic', strong: ['history', 'geography'] }, // Darwin
  1: { kind: 'basic', strong: ['history', 'art'] }, // Churchill
  2: { kind: 'basic', strong: ['history', 'sport'] }, // Coubertin
  3: { kind: 'basic', strong: ['history', 'science'] }, // Franklin
  4: { kind: 'basic', strong: ['geography', 'art'] }, // Verne
  5: { kind: 'basic', strong: ['geography', 'sport'] }, // Grylls
  6: { kind: 'basic', strong: ['geography', 'science'] }, // Galilei
  7: { kind: 'basic', strong: ['art', 'sport'] }, // Lee
  8: { kind: 'basic', strong: ['art', 'science'] }, // Einstein
  9: { kind: 'basic', strong: ['sport', 'science'] }, // Bohr
  10: { kind: 'basic', strong: ['history'] }, // Victoria
  11: { kind: 'basic', strong: ['geography'] }, // Earhart
  12: { kind: 'basic', strong: ['art'] }, // Hepburn
  13: { kind: 'basic', strong: ['sport'] }, // Serena
  14: { kind: 'basic', strong: ['science'] }, // Curie
  15: { kind: 'reborn', strong: ['history'] }, // Napoleon
  16: { kind: 'reborn', strong: ['geography'] }, // Columbus
  17: { kind: 'reborn', strong: ['art'] }, // Dali
  18: { kind: 'reborn', strong: ['sport'] }, // Ali
  19: { kind: 'reborn', strong: ['science'] }, // Tesla
  20: { kind: 'reborn', strong: ['history'] }, // Cleopatra
  21: { kind: 'reborn', strong: ['geography'] }, // Wanda
  22: { kind: 'reborn', strong: ['art'] }, // Monroe
  23: { kind: 'reborn', strong: ['sport'] }, // Sonja
  24: { kind: 'reborn', strong: ['science'] }, // Ada
  25: { kind: 'premium', strong: [] }, // Nietzsche
  26: { kind: 'premium', strong: [] }, // Hemingway
  27: { kind: 'premium', strong: [] }, // Carroll
  28: { kind: 'premium', strong: [] }, // Rowling
};

const KIND_GROUPS: { kind: CharacterKind | 'other'; label: string; note: string }[] = [
  { kind: 'basic', label: 'Базові', note: 'гравець БЕЗ реборну — те, чим є тестовий акаунт' },
  { kind: 'reborn', label: 'Реборн', note: 'тільки гравцеві, що пройшов реборн' },
  { kind: 'premium', label: 'Преміум', note: 'за задумом потрібні в boughtCharacters' },
  { kind: 'other', label: 'Без типу', note: 'є в gameAssets, але не в таблиці типів' },
];

/**
 * The gallery is driven by CHARACTER_COUNT, not by CHARACTER_META's own length: if the game ever
 * gains a character and only gameAssets.ts is updated, it still shows up here — in the «Без типу»
 * group, which is exactly the state worth seeing, instead of silently vanishing from the picker.
 */
const GALLERY = (() => {
  const buckets: Record<string, number[]> = { basic: [], reborn: [], premium: [], other: [] };
  for (let id = 0; id < CHARACTER_COUNT; id++) buckets[CHARACTER_META[id]?.kind ?? 'other'].push(id);
  return KIND_GROUPS.map((g) => ({ ...g, ids: buckets[g.kind] })).filter((g) => g.ids.length > 0);
})();

/**
 * Codes beG.changeFlag accepts that are not countries: 'UN' is what main-server stamps on every
 * player geoip cannot place (lib/utils.js:53 — i.e. EVERY localhost mock player), '??' is the
 * server's own unknown marker, 'EU' is the union, and 'WG' has no ISO country behind it at all, so
 * flagcdn 404s on it and the picture falls back to the white flag. They are pulled out of the
 * country grid because a tester looking for a country is not looking for these.
 */
const SERVICE_FLAGS = ['UN', 'EU', '??', 'WG'];

/**
 * Every free flag main-server accepts, minus SERVICE_FLAGS, sorted.
 *
 * Extracted from main-server/applications/beGenius/lib/flags.js (`api.beGenius.flags.free`,
 * 245 codes) on 2026-08-05 by script rather than by hand — beG.changeFlag validates against
 * `flags.all` and answers "Wrong flag name" for anything outside it (lib/player.js:162), so a
 * mistyped code here would be a dead button. 241 + 4 service = the server's 245.
 */
const COUNTRY_FLAGS = [
  'AD', 'AE', 'AF', 'AG', 'AI', 'AL', 'AM', 'AO', 'AQ', 'AR', 'AS', 'AT',
  'AU', 'AW', 'AX', 'AZ', 'BA', 'BB', 'BD', 'BE', 'BF', 'BG', 'BH', 'BI',
  'BJ', 'BL', 'BM', 'BN', 'BO', 'BQ', 'BR', 'BS', 'BT', 'BV', 'BW', 'BY',
  'BZ', 'CA', 'CD', 'CF', 'CG', 'CH', 'CI', 'CK', 'CL', 'CM', 'CN', 'CO',
  'CR', 'CU', 'CV', 'CW', 'CY', 'CZ', 'DE', 'DJ', 'DK', 'DM', 'DO', 'DZ',
  'EC', 'EE', 'EG', 'ER', 'ES', 'ET', 'FI', 'FJ', 'FK', 'FM', 'FO', 'FR',
  'GA', 'GB', 'GD', 'GE', 'GF', 'GG', 'GH', 'GI', 'GL', 'GM', 'GN', 'GP',
  'GQ', 'GR', 'GS', 'GT', 'GU', 'GW', 'GY', 'HK', 'HN', 'HR', 'HT', 'HU',
  'ID', 'IE', 'IL', 'IM', 'IN', 'IO', 'IQ', 'IR', 'IS', 'IT', 'JE', 'JM',
  'JO', 'JP', 'KE', 'KG', 'KH', 'KI', 'KM', 'KN', 'KP', 'KR', 'KW', 'KY',
  'KZ', 'LA', 'LB', 'LC', 'LI', 'LK', 'LR', 'LS', 'LT', 'LU', 'LV', 'LY',
  'MA', 'MC', 'MD', 'ME', 'MF', 'MG', 'MH', 'MK', 'ML', 'MM', 'MN', 'MO',
  'MP', 'MQ', 'MR', 'MS', 'MT', 'MU', 'MV', 'MW', 'MX', 'MY', 'MZ', 'NA',
  'NC', 'NE', 'NF', 'NG', 'NI', 'NL', 'NO', 'NP', 'NR', 'NU', 'NZ', 'OM',
  'PA', 'PE', 'PF', 'PG', 'PH', 'PK', 'PL', 'PM', 'PN', 'PR', 'PS', 'PT',
  'PW', 'PY', 'QA', 'RE', 'RO', 'RS', 'RU', 'RW', 'SA', 'SB', 'SC', 'SD',
  'SE', 'SG', 'SI', 'SJ', 'SK', 'SL', 'SM', 'SN', 'SO', 'SR', 'SS', 'ST',
  'SV', 'SX', 'SY', 'SZ', 'TC', 'TD', 'TG', 'TH', 'TJ', 'TK', 'TL', 'TM',
  'TN', 'TO', 'TR', 'TT', 'TV', 'TW', 'TZ', 'UA', 'UG', 'US', 'UY', 'UZ',
  'VA', 'VC', 'VE', 'VG', 'VI', 'VN', 'VU', 'WS', 'YE', 'YT', 'ZA', 'ZM',
  'ZW',
];

const ALL_FLAG_COUNT = COUNTRY_FLAGS.length + SERVICE_FLAGS.length + PREMIUM_FLAGS.length;

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
const GRANT_EXPERIENCE = 5000;
const GRANT_GEMS = 500;

// ─── small helpers ───────────────────────────────────────────────────────────

/**
 * Country name for the search box, from the platform's own CLDR data — 241 hand-typed names would
 * be 241 chances to be wrong about a country, and Intl is already in the runtime, so this costs no
 * dependency. Codes CLDR does not know (WG) come back as the code itself, and malformed ones ('??')
 * throw; both answer '' so the tile just shows the code.
 */
const REGION_NAMES = (() => {
  try {
    return new Intl.DisplayNames(['uk', 'en'], { type: 'region' });
  } catch {
    return null;
  }
})();

// Memoised because the search box calls this for all 245 codes on EVERY keystroke, and again for
// every caption it renders. The answer depends only on the code and never changes at runtime.
const REGION_CACHE = new Map<string, string>();

const regionName = (code: string): string => {
  const hit = REGION_CACHE.get(code);
  if (hit !== undefined) return hit;
  let name = '';
  if (REGION_NAMES && /^[A-Za-z]{2}$/.test(code)) {
    try {
      const resolved = REGION_NAMES.of(code.toUpperCase());
      // CLDR answers with the code itself for a region it does not know (WG) — that is a miss,
      // not a name, and showing it twice on one tile would look like a rendering bug.
      name = !resolved || resolved === code.toUpperCase() ? '' : resolved;
    } catch {
      name = ''; // malformed code ('??') — RangeError, not a reason to break the grid
    }
  }
  REGION_CACHE.set(code, name);
  return name;
};

/**
 * Plain-language reading of the refusals main-server actually produces here. The raw message is
 * ALWAYS shown next to this — the hint explains, it never replaces, and an error with no hint is
 * still shown in full rather than swallowed.
 *
 * The gateway turns an application error into `error.description` or, when there is none, into the
 * JSON of the error object (gateway/index.js:189) — that is why notEnoughGems, which carries only
 * `code: 302` (lib/errors.js:50), is matched as a number.
 */
const errorHint = (raw: string): string | null => {
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

/**
 * Walks a list of image URLs, moving to the next one on error and stopping at `null`.
 *
 * A deliberate copy of App.tsx's useImageChain rather than an import: that hook and the FlagImg /
 * CharacterImg components around it are module-private in App.tsx, and importing from App.tsx —
 * the module that renders THIS one — would close an import cycle. The behaviour needed is the
 * same, so if App.tsx ever exports them, this and the three components below should go.
 *
 * Running off the end has to be a real state: an <img> whose last source 404s paints the browser's
 * broken-image glyph, which is a different size and re-flows the tile grid around it.
 */
function useArtwork(chain: (string | null)[]): [string | null, () => void] {
  const urls = chain.filter((u): u is string => !!u);
  const key = urls.join('|');
  const [tried, setTried] = useState({ key, failed: 0 });
  // Reset during render, not in an effect: these cells are recycled as the search filters the
  // grid, and an effect would leave one frame showing the previous cell's picture.
  if (tried.key !== key) setTried({ key, failed: 0 });
  const failed = tried.key === key ? tried.failed : 0;
  return [urls[failed] ?? null, () => setTried({ key, failed: failed + 1 })];
}

/** Gallery thumbnail: row icon first, full-body art as the fallback, the index as the last resort. */
function TileArt({ id }: { id: number }) {
  const [src, onError] = useArtwork([characterIconUrl(id), characterFullUrl(id)]);
  return (
    <span className="art">
      {src ? <img src={src} alt="" onError={onError} loading="lazy" /> : <>#{id}</>}
    </span>
  );
}

/** The point of the whole screen: the selected character drawn BIG, full-body art first. */
function Portrait({ id }: { id: number }) {
  const [src, onError] = useArtwork([characterFullUrl(id), characterIconUrl(id)]);
  const label = characterName(id) ?? `#${id}`;
  return (
    <div className="ce-portrait">
      {src ? <img src={src} alt={label} onError={onError} /> : <span>артворку немає</span>}
    </div>
  );
}

/** One flag picture, with the same "never show a broken glyph" chain as the roster rows. */
function FlagArt({ flag }: { flag: string }) {
  const primary = flagImageUrl(flag);
  // The unknown-flag fallback is dropped when the primary already IS it: re-setting a
  // byte-identical src fires no second error, so the chain would hang instead of ending.
  const chain = primary ? (primary === unknownFlagUrl ? [primary] : [primary, unknownFlagUrl]) : [];
  const [src, onError] = useArtwork(chain);
  return (
    <span className="art fit">
      {src ? <img src={src} alt="" onError={onError} loading="lazy" /> : <>?</>}
    </span>
  );
}

// ─── the editor ──────────────────────────────────────────────────────────────

export interface CharacterEditorProps {
  open: boolean;
  onClose: () => void;
  /** what the player looks like right now, as far as the client knows */
  current: {
    character?: number;
    flag?: string;
    name?: string;
    playerId?: string;
    /** reborn players choose 2 categories instead of 3 — see wantCategories below */
    reborn?: boolean;
  };
  /** non-null while a call is in flight; also the label to show */
  busy: string | null;
  /** beG.resetChar — throws with the server's message on refusal */
  onApplyCharacter: (payload: { character: number; categories: string[] }) => Promise<void>;
  /** beG.changeFlag */
  onApplyFlag: (flag: string) => Promise<void>;
  /** adminApi.grantToPlayer — testbed-only unlock */
  onGrant: (payload: {
    characters?: number[];
    flags?: string[];
    experience?: number;
    gems?: number;
  }) => Promise<void>;
}

/** Everything that must snap back to the player's real state each time the modal is opened. */
interface EditorUi {
  tab: 'character' | 'flag';
  selected: number;
  /** ORDER matters: [0] and [1] are the strong pair, [2] is the weak one — see resetChar. */
  categories: string[];
  search: string;
  error: string | null;
  hint: string | null;
  done: string | null;
}

const freshUi = (current: CharacterEditorProps['current']): EditorUi => {
  const selected =
    typeof current.character === 'number' && current.character >= 0 ? current.character : 0;
  return {
    tab: 'character',
    selected,
    categories: (CHARACTER_META[selected]?.strong ?? []).slice(0, 2),
    search: '',
    error: null,
    hint: null,
    done: null,
  };
};

export function CharacterEditor({
  open,
  onClose,
  current,
  busy,
  onApplyCharacter,
  onApplyFlag,
  onGrant,
}: CharacterEditorProps): ReactElement | null {
  const [ui, setUi] = useState<EditorUi>(() => freshUi(current));
  const [wasOpen, setWasOpen] = useState(open);

  // Re-opening the editor must not resurrect the previous session's selection or its red banner.
  // Done during render (React's own "adjust state when a prop changes" pattern) rather than in an
  // effect, because an effect paints one frame of the stale state first.
  if (wasOpen !== open) {
    setWasOpen(open);
    if (open) setUi(freshUi(current));
  }

  const patch = (p: Partial<EditorUi>) => setUi((u) => ({ ...u, ...p }));

  // Switching tabs drops the last server answer with it: «прапор UA застосовано» left hanging over
  // the character gallery reads as if THAT call had just succeeded.
  const goTab = (tab: EditorUi['tab']) => patch({ tab, error: null, hint: null, done: null });

  /**
   * The one place where a server answer becomes screen state. The raw message is kept verbatim —
   * this is a testbed, the exact wording IS the finding — and the hint is added beside it only
   * when we recognise the refusal. An unrecognised error keeps an empty hint, never a guess.
   */
  const run = async (label: string, action: () => Promise<void>) => {
    patch({ error: null, hint: null, done: null });
    try {
      await action();
      patch({ done: label });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      patch({ error: message, hint: errorHint(message) });
    }
  };

  // Every hook is above this line: the modal is unmounted rather than merely hidden, so a closed
  // editor does not keep building 274 tiles on every render of the page behind it.
  if (!open) return null;

  const locked = busy !== null;
  const meta = CHARACTER_META[ui.selected];
  // A reborn player picks 1 strong + 1 weak, everyone else 2 strong + 1 weak — resetChar
  // enforces exactly this count (lib/characters.js) and answers a wrong one through a
  // mistyped `api.beGenius.error`, which THROWS instead of replying: the tester would just
  // watch the call hang until the gateway's 15s timeout. So the picker must never be able to
  // build a selection the server will reject.
  const wantCategories = current.reborn ? 2 : 3;
  const missing = wantCategories - ui.categories.length;
  const ready = ui.categories.length === wantCategories;
  const canGrant = !!current.playerId;

  const toggleCategory = (id: string) =>
    setUi((u) => {
      if (u.categories.includes(id)) {
        return { ...u, categories: u.categories.filter((c) => c !== id) };
      }
      // The extra pick is refused rather than rotating the list: the slots row above shows every
      // seat is taken, so a silent swap would look like the click did something random.
      if (u.categories.length >= wantCategories) return u;
      return { ...u, categories: [...u.categories, id] };
    });

  const selectCharacter = (id: number) =>
    // Picking a character preloads ITS strong categories: that is the loadout the game itself
    // gives it, so the usual case becomes one more click (the weak one) instead of three, and
    // the difference between characters stays visible.
    patch({
      selected: id,
      categories: (CHARACTER_META[id]?.strong ?? []).slice(0, 2),
      error: null,
      hint: null,
      done: null,
    });

  /** What the server is expected to say about the selected character, before it is asked. */
  const verdict = (): ReactNode => {
    if (!meta) return <span className="warn">Немає в таблиці типів — сервер може відмовити.</span>;
    if (meta.kind === 'basic')
      return <span className="ok">Базовий — доступний тестовому гравцеві без реборну.</span>;
    if (meta.kind === 'reborn')
      return (
        <span className="warn">
          Реборн-персонаж: без пройденого реборну сервер відповість «Wrong character index».
        </span>
      );
    return (
      <span className="warn">
        Преміум: за задумом потрібен у boughtCharacters — спершу «Видати цього персонажа».
      </span>
    );
  };

  const grantButtons = (
    <div className="ui-actions">
      <button
        type="button"
        disabled={locked || !canGrant}
        onClick={() =>
          run(`видано ${GRANT_EXPERIENCE} досвіду`, () => onGrant({ experience: GRANT_EXPERIENCE }))
        }
      >
        +{GRANT_EXPERIENCE} досвіду
      </button>
      <button
        type="button"
        disabled={locked || !canGrant}
        onClick={() => run(`видано ${GRANT_GEMS} кристалів`, () => onGrant({ gems: GRANT_GEMS }))}
      >
        +{GRANT_GEMS} кристалів
      </button>
      <button
        type="button"
        disabled={locked || !canGrant}
        onClick={() =>
          run(`видано персонажа #${ui.selected}`, () => onGrant({ characters: [ui.selected] }))
        }
      >
        Видати цього персонажа
      </button>
      <button
        type="button"
        disabled={locked || !canGrant}
        onClick={() => run('видано преміум-прапори', () => onGrant({ flags: PREMIUM_FLAGS }))}
      >
        Видати всі преміум-прапори
      </button>
    </div>
  );

  const characterTab = (
    <div className="ce-split">
      <div className="ce-gallery">
        {GALLERY.map((group) => (
          <section key={group.kind} className="ce-group">
            <h4 className="ui-h">
              {group.label} <span>{group.note}</span>
            </h4>
            <div className="ui-grid">
              {group.ids.map((id) => {
                const mine = id === current.character;
                const gated = group.kind === 'reborn' || group.kind === 'premium';
                return (
                  <button
                    key={id}
                    type="button"
                    className={`ui-tile${id === ui.selected ? ' is-on' : ''}${
                      gated && !mine ? ' is-locked' : ''
                    }`}
                    aria-pressed={id === ui.selected}
                    onClick={() => selectCharacter(id)}
                  >
                    <TileArt id={id} />
                    <span className="cap">{characterName(id) ?? '—'}</span>
                    <span className="cap ce-ix">#{id}</span>
                    {/* One badge per tile: the current character is by definition allowed, so
                        "зараз" and the gate marker can never both apply. */}
                    {mine ? (
                      <span className="lock ce-now">зараз</span>
                    ) : (
                      gated && (
                        <span className="lock">
                          {group.kind === 'reborn' ? 'реборн' : 'грант'}
                        </span>
                      )
                    )}
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </div>

      <div className="ce-side">
        <Portrait id={ui.selected} />
        <div className="ce-name">
          <b>{characterName(ui.selected) ?? 'невідомий персонаж'}</b>
          <span>#{ui.selected}</span>
        </div>
        <p className="ce-verdict">{verdict()}</p>

        <div>
          <h4 className="ui-h">Категорії — рівно 3, у порядку вибору</h4>
          {/* Fixed seats rather than a bag of chips: resetChar splits the array by POSITION —
              non-reborn takes [0,1] strong and [2] weak, reborn takes [0] strong and [1] weak
              (lib/characters.js:320-321) — so the order carries meaning and the weak seat is
              always the last one. */}
          <div className="ce-slots">
            {Array.from({ length: wantCategories }, (_, slot) => {
              const picked = ui.categories[slot];
              const isWeak = slot === wantCategories - 1;
              return (
                <div key={slot} className={`ce-slot${isWeak ? ' weak' : ''}${picked ? ' on' : ''}`}>
                  <span>{isWeak ? 'слабка' : `сильна ${slot + 1}`}</span>
                  <b>{CATEGORIES.find((c) => c.id === picked)?.label ?? '—'}</b>
                </div>
              );
            })}
          </div>
          <div className="ui-picks">
            {CATEGORIES.map((c) => {
              const at = ui.categories.indexOf(c.id);
              return (
                <button
                  key={c.id}
                  type="button"
                  className={at >= 0 ? `is-on${at === wantCategories - 1 ? ' ce-weak' : ''}` : ''}
                  aria-pressed={at >= 0}
                  onClick={() => toggleCategory(c.id)}
                >
                  {c.label}
                  {at >= 0 && (
                    <i>{at === wantCategories - 1 ? 'слабка' : `сильна ${at + 1}`}</i>
                  )}
                </button>
              );
            })}
          </div>
          <p className="ui-sub ce-gap">
            {current.reborn
              ? 'Гравець реборн — сервер чекає рівно 2 категорії: одну сильну й одну слабку.'
              : 'Рівно 3 категорії: дві сильні й одна слабка. Реборн-гравцеві сервер чекає 2 — редактор перемкнеться сам.'}
          </p>
        </div>

        <div className="ce-grant">
          <h4 className="ui-h">
            Тестовий шорткат · adminApi.grantToPlayer
            <span>не клієнтський RPC: гравець нічого не «купує», це видача з адмінки</span>
          </h4>
          {grantButtons}
          {!canGrant && (
            <p className="ui-sub ce-gap">
              playerId невідомий — grantToPlayer без нього відповідає «playerId is required».
              Спершу увійди в main-server.
            </p>
          )}
        </div>
      </div>
    </div>
  );

  const query = ui.search.trim().toLowerCase();
  const matches = (code: string) =>
    query === '' ||
    code.toLowerCase().includes(query) ||
    regionName(code).toLowerCase().includes(query);
  const countries = COUNTRY_FLAGS.filter(matches);
  const service = SERVICE_FLAGS.filter(matches);
  const premium = PREMIUM_FLAGS.filter((n) => query === '' || n.toLowerCase().includes(query));

  const flagTile = (code: string, note?: string) => (
    <button
      key={code}
      type="button"
      // `is-locked` and not `disabled`: a premium flag stays clickable because clicking it is how
      // the tester learns from the server itself that it needs a grant first.
      className={`ui-tile${code === current.flag ? ' is-on' : ''}${note ? ' is-locked' : ''}`}
      aria-pressed={code === current.flag}
      disabled={locked}
      title={note ? `${code} — ${note}` : code}
      onClick={() => run(`прапор ${code} застосовано`, () => onApplyFlag(code))}
    >
      <FlagArt flag={code} />
      <span className="cap ce-code">{code}</span>
      {/* '—' rather than nothing when CLDR has no name (WG, '??'): an empty caption collapses to
          zero height and that one tile would sit taller than the rest of its row. */}
      <span className="cap">{note ?? (regionName(code) || '—')}</span>
      {note && <span className="lock">грант</span>}
    </button>
  );

  const flagTab = (
    <div className="ui-stack ce-flags">
      <div className="ce-searchrow">
        <label className="ui-field">
          <span className="ui-label">Пошук прапора</span>
          <input
            className="ui-input"
            type="search"
            value={ui.search}
            placeholder="код («UA») або назва («Україна»)"
            onChange={(e) => patch({ search: e.target.value })}
          />
        </label>
        <span className="ui-sub">
          {countries.length + service.length + premium.length} з {ALL_FLAG_COUNT}
        </span>
      </div>

      {premium.length > 0 && (
        <section>
          <h4 className="ui-h">
            Преміум <span>потрібні в boughtFlags — інакше «not bought»</span>
          </h4>
          <div className="ui-grid">{premium.map((name) => flagTile(name, 'потрібен грант'))}</div>
          <div className="ui-actions ce-gap">
            <button
              type="button"
              disabled={locked || !canGrant}
              onClick={() => run('видано преміум-прапори', () => onGrant({ flags: PREMIUM_FLAGS }))}
            >
              Видати всі преміум-прапори
            </button>
          </div>
        </section>
      )}

      {service.length > 0 && (
        <section>
          <h4 className="ui-h">
            Службові <span>не країни; UN — те, що сервер ставить кожному mock-гравцеві</span>
          </h4>
          <div className="ui-grid">{service.map((code) => flagTile(code))}</div>
        </section>
      )}

      <section>
        <h4 className="ui-h">
          Країни <span>усі вільні коди з api.beGenius.flags.free</span>
        </h4>
        {countries.length === 0 ? (
          <p className="ui-sub">Нічого не знайшлося — спробуй код («UA») або назву («Україна»).</p>
        ) : (
          <div className="ui-grid">{countries.map((code) => flagTile(code))}</div>
        )}
      </section>
    </div>
  );

  const footer = (
    <>
      <span className="spread ce-status">
        {busy ??
          (ui.tab === 'flag'
            ? 'Прапор застосовується одразу після кліку'
            : ready
              ? 'Готово до застосування'
              : `Вибери ще ${missing} ${missing === 1 ? 'категорію' : 'категорії'}`)}
      </span>
      <button type="button" onClick={onClose} disabled={locked}>
        Закрити
      </button>
      {ui.tab === 'character' && (
        <button
          type="button"
          className="primary"
          disabled={locked || !ready}
          onClick={() =>
            run(`персонаж #${ui.selected} застосований`, () =>
              onApplyCharacter({ character: ui.selected, categories: ui.categories }),
            )
          }
        >
          Застосувати персонажа
        </button>
      )}
    </>
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      busy={locked}
      size="lg"
      title="Персонаж і прапор"
      subtitle={
        <>
          {current.name ? <b>{current.name}</b> : 'гравець без імені'}
          {current.playerId && <code> {current.playerId}</code>}
          {' · зараз '}
          {characterName(current.character) ?? `#${current.character ?? '—'}`}
          {' · '}
          {current.flag || 'без прапора'}
        </>
      }
      footer={footer}
    >
      {/* `ce` scopes every override of a shared ui.css class to this screen — a bare `.ui-h span`
          rule here would silently restyle every other dialog built on the same kit. */}
      <div className="ui-stack ce">
        <div className="ui-seg ce-tabs" role="tablist" aria-label="Що редагуємо">
          {(
            [
              ['character', 'Персонаж'],
              ['flag', 'Прапор'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              id={`ce-tab-${key}`}
              aria-selected={ui.tab === key}
              // Only one panel is ever in the DOM, so only the SELECTED tab may claim it —
              // aria-controls on the other one would point at an id that does not exist.
              aria-controls={ui.tab === key ? 'ce-panel' : undefined}
              // Roving tabindex: the strip is ONE tab stop and arrows move inside it, which is
              // what a screen-reader user expects of role="tablist".
              tabIndex={ui.tab === key ? 0 : -1}
              className={ui.tab === key ? 'is-on' : ''}
              onClick={() => goTab(key)}
              onKeyDown={(e) => {
                if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
                e.preventDefault();
                const next = ui.tab === 'character' ? 'flag' : 'character';
                goTab(next);
                document.getElementById(`ce-tab-${next}`)?.focus();
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {/* The single most confusing thing about this screen, so it never scrolls away. */}
        <p className="ui-note warn">
          Персонаж, прапор і клан копіюються в ростер у момент RegisterPlayer. Зміни, зроблені після
          «Зайти в Survival», з’являться тільки в НАСТУПНОМУ лобі — поточне тримає старий знімок.
        </p>

        {ui.error && (
          <div className="ui-note bad">
            <b>Сервер відмовив:</b> <code className="ce-raw">{ui.error}</code>
            {ui.hint && <p className="ce-gap">{ui.hint}</p>}
          </div>
        )}
        {ui.done && !ui.error && <p className="ui-note ok">{ui.done}</p>}

        <div role="tabpanel" id="ce-panel" aria-labelledby={`ce-tab-${ui.tab}`} tabIndex={-1}>
          {ui.tab === 'character' ? characterTab : flagTab}
        </div>
      </div>
    </Modal>
  );
}
