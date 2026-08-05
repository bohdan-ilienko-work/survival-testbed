// The flag tab: search over 245 codes, and three grids that apply one the moment it is clicked.
//
// The whole tab is one file because it is one gesture — there is no draft state and no apply
// button here, unlike the character tab; a click IS the call. The search box, the three sections
// and the tile they all render are that gesture's only moving parts.

import type { ReactElement } from 'react';
import { ALL_FLAG_COUNT, COUNTRY_FLAGS, SERVICE_FLAGS, regionName } from './flagCatalog';
import type { Grant, Run } from './editorModel';
import { PREMIUM_FLAGS, flagImageUrl, unknownFlagUrl } from '../gameAssets';
import { useArtwork } from './useArtwork';

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

export interface FlagPickerProps {
  /** the flag the player is wearing, as far as the client knows */
  current: string | undefined;
  search: string;
  onSearch: (value: string) => void;
  locked: boolean;
  canGrant: boolean;
  run: Run;
  onApplyFlag: (flag: string) => Promise<void>;
  onGrant: Grant;
}

export function FlagPicker({
  current,
  search,
  onSearch,
  locked,
  canGrant,
  run,
  onApplyFlag,
  onGrant,
}: FlagPickerProps): ReactElement {
  const query = search.trim().toLowerCase();
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
      className={`ui-tile${code === current ? ' is-on' : ''}${note ? ' is-locked' : ''}`}
      aria-pressed={code === current}
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

  return (
    <div className="ui-stack ce-flags">
      <div className="ce-searchrow">
        <label className="ui-field">
          <span className="ui-label">Пошук прапора</span>
          <input
            className="ui-input"
            type="search"
            value={search}
            placeholder="код («UA») або назва («Україна»)"
            onChange={(e) => onSearch(e.target.value)}
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
}
