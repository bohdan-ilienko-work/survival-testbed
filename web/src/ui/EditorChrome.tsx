// The editor's chrome: the tab strip above the panels and the action row below them.
//
// Neither belongs to a panel — they are what the dialog says about ITSELF (which half you are
// looking at, what it is willing to do next), and both are pure functions of the editor's state.
// Kept in one file because they are the two ends of the same frame; the stylesheet splits the same
// way (css/ce-chrome.css).

import type { ReactElement } from 'react';
import type { ApplyCharacter, EditorUi, Run } from './editorModel';

export interface EditorTabsProps {
  tab: EditorUi['tab'];
  onTab: (tab: EditorUi['tab']) => void;
}

export function EditorTabs({ tab, onTab }: EditorTabsProps): ReactElement {
  return (
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
          aria-selected={tab === key}
          // Only one panel is ever in the DOM, so only the SELECTED tab may claim it —
          // aria-controls on the other one would point at an id that does not exist.
          aria-controls={tab === key ? 'ce-panel' : undefined}
          // Roving tabindex: the strip is ONE tab stop and arrows move inside it, which is
          // what a screen-reader user expects of role="tablist".
          tabIndex={tab === key ? 0 : -1}
          className={tab === key ? 'is-on' : ''}
          onClick={() => onTab(key)}
          onKeyDown={(e) => {
            if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
            e.preventDefault();
            const next = tab === 'character' ? 'flag' : 'character';
            onTab(next);
            document.getElementById(`ce-tab-${next}`)?.focus();
          }}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

export interface EditorFooterProps {
  ui: EditorUi;
  /** the in-flight call's label, or null; doubles as the status line while it is set */
  busy: string | null;
  locked: boolean;
  /** enough categories picked for the server to accept them */
  ready: boolean;
  /** how many are still missing — 0 once ready */
  missing: number;
  run: Run;
  onApplyCharacter: ApplyCharacter;
  onClose: () => void;
}

/**
 * A fragment, because .modal-foot is the flex row itself — `.spread` on the status line is what
 * pins it left and pushes the buttons right, and an extra wrapper would take that away.
 *
 * There is no «Застосувати прапор» twin: a flag tile IS the call, so on the flag tab the status
 * line says so rather than offering a button that would have nothing left to do.
 */
export function EditorFooter({
  ui,
  busy,
  locked,
  ready,
  missing,
  run,
  onApplyCharacter,
  onClose,
}: EditorFooterProps): ReactElement {
  return (
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
}
