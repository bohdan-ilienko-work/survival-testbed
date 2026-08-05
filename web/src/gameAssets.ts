// Character portraits and flag images for the lobby roster.
//
// Ported from the admin panel (../admin-tools-react-frontend: src/components/CharacterIcon.tsx
// and src/components/FlagSources.tsx) so both tools name and resolve the same artwork. The PNGs
// under web/public/characters/ are copied from that repo's public/characters/ — keep the two in
// step if the game ever ships a new character.
//
// The server side of this is thin on purpose: survival-server sends `character` as a plain index
// and `flag` as a code or a premium flag NAME (see LobbyRosterEntry), and every mapping from
// those to an image lives here.

/**
 * Character index → name, exactly as the game numbers them. This is main-server's `player.character`
 * travelling through RegisterPlayer into the roster, so the ids are the game's, not ours.
 */
const CHARACTER_NAME_BY_ID: Record<number, string> = {
  0: 'Darwin',
  1: 'Churchill',
  2: 'Coubertin',
  3: 'Franklin',
  4: 'Verne',
  5: 'Grylls',
  6: 'Galilei',
  7: 'Lee',
  8: 'Einstein',
  9: 'Bohr',
  10: 'Victoria',
  11: 'Earhart',
  12: 'Hepburn',
  13: 'Serena',
  14: 'Curie',
  15: 'Napoleon',
  16: 'Columbus',
  17: 'Dali',
  18: 'Ali',
  19: 'Tesla',
  20: 'Cleopatra',
  21: 'Wanda',
  22: 'Monroe',
  23: 'Sonja',
  24: 'Ada',
  25: 'Nietzsche',
  26: 'Hemingway',
  27: 'Carroll',
  28: 'Rowling',
};

/** How many characters the game has — the testbed uses it to spread mock players across them. */
export const CHARACTER_COUNT = Object.keys(CHARACTER_NAME_BY_ID).length;

/** Human name for a character index, `undefined` for an index the game does not have. */
export function characterName(id?: number): string | undefined {
  return typeof id === 'number' ? CHARACTER_NAME_BY_ID[id] : undefined;
}

/**
 * The small head-and-shoulders icon used in list rows.
 *
 * `characters/Icon<Name>.png` rather than the admin panel's `icons/Icon<Name>.png`: that folder
 * carries all 29 icons while `icons/` is missing six of them, and a roster row with a hole in it
 * is worse than one extra copied directory.
 * Returns null when the index is unknown, so the caller can fall back instead of requesting a 404.
 */
export function characterIconUrl(id?: number): string | null {
  const name = characterName(id);
  return name ? `/characters/Icon${name}.png` : null;
}

/** The full-body portrait, keyed by index rather than name — the natural onError fallback. */
export function characterFullUrl(id?: number): string | null {
  return typeof id === 'number' && CHARACTER_NAME_BY_ID[id] ? `/characters/char${id}.png` : null;
}

// ─── Flags ────────────────────────────────────────────────────────────────────

export const countryFlagUrl = (code: string) => `https://flagcdn.com/${code.toLowerCase()}.svg`;

/** Twemoji's white flag — for "the server sent something we cannot draw", never for a real country. */
export const unknownFlagUrl =
  'https://cdn.jsdelivr.net/gh/twitter/twemoji@14/assets/svg/1f3f3.svg';

/**
 * The bought flags, which are NOT country codes: main-server stores the flag NAME in the same
 * `player.flag` field. The seven names below are exactly `flags.premium`, i.e. the Name column of
 * main-server/applications/beGenius/files/premiumFlags.json — verified against it, not guessed.
 */
export const PREMIUM_FLAG_IMAGES: Record<string, string> = {
  Lgbt: 'https://commons.wikimedia.org/wiki/Special:FilePath/Colourblind-friendly_LGBT_rainbow_pride_flag.svg',
  Pacifism: 'https://commons.wikimedia.org/wiki/Special:FilePath/PACE-flag-en.svg',
  Anarchy: 'https://commons.wikimedia.org/wiki/Special:FilePath/Black_flag.svg',
  Pirate: 'https://commons.wikimedia.org/wiki/Special:FilePath/Calico_Jack_Jolly_Roger.svg',
  Gadsden: 'https://commons.wikimedia.org/wiki/Special:FilePath/Gadsden_Flag_(Accurate).svg',
  Anonymous: 'https://upload.wikimedia.org/wikipedia/commons/5/51/Anonymous_Flag.svg',
  AnarchoCapitalism:
    'https://commons.wikimedia.org/wiki/Special:FilePath/Flag_of_Anarcho-capitalism.svg',
};

export const PREMIUM_FLAGS = Object.keys(PREMIUM_FLAG_IMAGES);

/**
 * Picture for whatever `flag` the roster carried, following the admin panel's inferFlagImg:
 * a two-letter code is a country, a known name is a bought flag, anything else is unknown.
 *
 * Returns null for '' — that is a bot (survival-server's botProfile leaves the flag empty), and a
 * bot should show no flag at all rather than a placeholder. A LIVE player is never '': main-server
 * stamps 'UN' when geoip cannot place the IP.
 */
export function flagImageUrl(flag?: string): string | null {
  const value = (flag ?? '').trim();
  if (value === '') return null;
  if (/^[A-Za-z?]{2}$/.test(value)) {
    return value === '??' ? unknownFlagUrl : countryFlagUrl(value);
  }
  if (PREMIUM_FLAGS.includes(value)) return PREMIUM_FLAG_IMAGES[value];
  return unknownFlagUrl;
}
