// Ground truth about flags: every code beG.changeFlag accepts, split the way a tester looks for
// them, plus the country name to search each code by.
//
// A data module for the same reason as characterCatalog.ts — it is a transcription of the server's
// own table and has to be re-checkable against it without reading any UI. `regionName` lives here
// rather than in FlagPicker.tsx because it is part of naming a CODE, not part of drawing a tile.

import { PREMIUM_FLAGS } from '../gameAssets';

/**
 * Codes beG.changeFlag accepts that are not countries: 'UN' is what main-server stamps on every
 * player geoip cannot place (lib/utils.js:53 — i.e. EVERY localhost mock player), '??' is the
 * server's own unknown marker, 'EU' is the union, and 'WG' has no ISO country behind it at all, so
 * flagcdn 404s on it and the picture falls back to the white flag. They are pulled out of the
 * country grid because a tester looking for a country is not looking for these.
 */
export const SERVICE_FLAGS = ['UN', 'EU', '??', 'WG'];

/**
 * Every free flag main-server accepts, minus SERVICE_FLAGS, sorted.
 *
 * Extracted from main-server/applications/beGenius/lib/flags.js (`api.beGenius.flags.free`,
 * 245 codes) on 2026-08-05 by script rather than by hand — beG.changeFlag validates against
 * `flags.all` and answers "Wrong flag name" for anything outside it (lib/player.js:162), so a
 * mistyped code here would be a dead button. 241 + 4 service = the server's 245.
 */
export const COUNTRY_FLAGS = [
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

export const ALL_FLAG_COUNT = COUNTRY_FLAGS.length + SERVICE_FLAGS.length + PREMIUM_FLAGS.length;

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

export const regionName = (code: string): string => {
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
