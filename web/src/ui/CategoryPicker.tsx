// The category picker: three fixed seats and the chips that fill them.
//
// Its own file because the ORDER of the picks is the whole subtlety here — resetChar reads the
// array by position — and that story is told twice, once by the slots and once by the badge on
// each chip. Keeping them apart would let one drift from the other.

import type { ReactElement } from 'react';
import { CATEGORIES } from './characterCatalog';

export interface CategoryPickerProps {
  /** the picks so far, in the order they were made */
  categories: string[];
  /** how many the server expects: 3 normally, 2 for a reborn player */
  want: number;
  reborn: boolean | undefined;
  onToggle: (id: string) => void;
}

export function CategoryPicker({
  categories,
  want,
  reborn,
  onToggle,
}: CategoryPickerProps): ReactElement {
  return (
    <div>
      <h4 className="ui-h">Категорії — рівно 3, у порядку вибору</h4>
      {/* Fixed seats rather than a bag of chips: resetChar splits the array by POSITION —
          non-reborn takes [0,1] strong and [2] weak, reborn takes [0] strong and [1] weak
          (lib/characters.js:320-321) — so the order carries meaning and the weak seat is
          always the last one. */}
      <div className="ce-slots">
        {Array.from({ length: want }, (_, slot) => {
          const picked = categories[slot];
          const isWeak = slot === want - 1;
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
          const at = categories.indexOf(c.id);
          return (
            <button
              key={c.id}
              type="button"
              className={at >= 0 ? `is-on${at === want - 1 ? ' ce-weak' : ''}` : ''}
              aria-pressed={at >= 0}
              onClick={() => onToggle(c.id)}
            >
              {c.label}
              {at >= 0 && (
                <i>{at === want - 1 ? 'слабка' : `сильна ${at + 1}`}</i>
              )}
            </button>
          );
        })}
      </div>
      <p className="ui-sub ce-gap">
        {reborn
          ? 'Гравець реборн — сервер чекає рівно 2 категорії: одну сильну й одну слабку.'
          : 'Рівно 3 категорії: дві сильні й одна слабка. Реборн-гравцеві сервер чекає 2 — редактор перемкнеться сам.'}
      </p>
    </div>
  );
}
