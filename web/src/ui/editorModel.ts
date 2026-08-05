// The character editor's data model: the shapes its panels are wired with, the screen state it
// keeps, and the two edits that are more than a field assignment.
//
// A leaf module — it holds no JSX and imports nothing from any panel, so every panel can name its
// props from here without closing an import cycle back to CharacterEditor.tsx.

import { CHARACTER_META } from './characterCatalog';

/** What the player looks like right now, as far as the client knows. */
export interface EditorCurrent {
  character?: number;
  flag?: string;
  name?: string;
  playerId?: string;
  /** reborn players choose 2 categories instead of 3 — see wantCategories in CharacterEditor */
  reborn?: boolean;
}

/** The adminApi.grantToPlayer payload — testbed-only unlock, never a client RPC. */
export interface GrantPayload {
  characters?: number[];
  flags?: string[];
  experience?: number;
  gems?: number;
}

export type Grant = (payload: GrantPayload) => Promise<void>;

/** beG.resetChar's payload. The categories are positional — see EditorUi.categories. */
export type ApplyCharacter = (payload: {
  character: number;
  categories: string[];
}) => Promise<void>;

/**
 * How a panel asks for a server call: it names the success line to show and hands over the call
 * itself. Everything about the answer — the raw refusal, the hint, the green line — is the
 * editor's business, not the panel's. Implemented once, as `run` in CharacterEditor.tsx.
 */
export type Run = (label: string, action: () => Promise<void>) => void;

/** Everything that must snap back to the player's real state each time the modal is opened. */
export interface EditorUi {
  tab: 'character' | 'flag';
  selected: number;
  /** ORDER matters: [0] and [1] are the strong pair, [2] is the weak one — see resetChar. */
  categories: string[];
  search: string;
  error: string | null;
  hint: string | null;
  done: string | null;
}

export const freshUi = (current: EditorCurrent): EditorUi => {
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

export const withCharacterSelected = (ui: EditorUi, id: number): EditorUi => ({
  ...ui,
  selected: id,
  // Picking a character preloads ITS strong categories: that is the loadout the game itself
  // gives it, so the usual case becomes one more click (the weak one) instead of three, and
  // the difference between characters stays visible.
  categories: (CHARACTER_META[id]?.strong ?? []).slice(0, 2),
  error: null,
  hint: null,
  done: null,
});

export const withCategoryToggled = (ui: EditorUi, id: string, want: number): EditorUi => {
  if (ui.categories.includes(id)) {
    return { ...ui, categories: ui.categories.filter((c) => c !== id) };
  }
  // The extra pick is refused rather than rotating the list: the slots row above shows every
  // seat is taken, so a silent swap would look like the click did something random.
  if (ui.categories.length >= want) return ui;
  return { ...ui, categories: [...ui.categories, id] };
};
