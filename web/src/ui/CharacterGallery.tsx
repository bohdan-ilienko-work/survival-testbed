// The "which character" half of the character tab: the grouped grid you pick FROM, and the
// preview of what you picked.
//
// One file for the two of them because they are one conversation — the gallery only makes sense
// while something answers it, and the preview only ever shows the gallery's selection. They render
// into the two columns of .ce-split, so the editor places them; it does not know how they look.

import type { ReactElement, ReactNode } from 'react';
import { CHARACTER_META, GALLERY } from './characterCatalog';
import { characterFullUrl, characterIconUrl, characterName } from '../gameAssets';
import { useArtwork } from './useArtwork';

/** Gallery thumbnail: row icon first, full-body art as the fallback, the index as the last resort. */
function TileArt({ id }: { id: number }) {
  const [src, onError] = useArtwork([characterIconUrl(id), characterFullUrl(id)]);
  return (
    <span className="art">
      {src ? <img src={src} alt="" onError={onError} loading="lazy" /> : <>#{id}</>}
    </span>
  );
}

export interface CharacterGalleryProps {
  /** the tile drawn as chosen — the editor's draft, not the server's answer */
  selected: number;
  /** what the player is wearing right now, badged «зараз» */
  worn: number | undefined;
  onSelect: (id: number) => void;
}

export function CharacterGallery({
  selected,
  worn,
  onSelect,
}: CharacterGalleryProps): ReactElement {
  return (
    <div className="ce-gallery">
      {GALLERY.map((group) => (
        <section key={group.kind} className="ce-group">
          <h4 className="ui-h">
            {group.label} <span>{group.note}</span>
          </h4>
          <div className="ui-grid">
            {group.ids.map((id) => {
              const mine = id === worn;
              const gated = group.kind === 'reborn' || group.kind === 'premium';
              return (
                <button
                  key={id}
                  type="button"
                  className={`ui-tile${id === selected ? ' is-on' : ''}${
                    gated && !mine ? ' is-locked' : ''
                  }`}
                  aria-pressed={id === selected}
                  onClick={() => onSelect(id)}
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

/** What the server is expected to say about the selected character, before it is asked. */
const verdict = (id: number): ReactNode => {
  const meta = CHARACTER_META[id];
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

/**
 * A fragment, not a box: these three sit directly in .ce-side's flex column, and wrapping them
 * in a <div> of their own would put the category picker and the grant box a gap further down.
 */
export function CharacterPreview({ id }: { id: number }): ReactElement {
  return (
    <>
      <Portrait id={id} />
      <div className="ce-name">
        <b>{characterName(id) ?? 'невідомий персонаж'}</b>
        <span>#{id}</span>
      </div>
      <p className="ce-verdict">{verdict(id)}</p>
    </>
  );
}
