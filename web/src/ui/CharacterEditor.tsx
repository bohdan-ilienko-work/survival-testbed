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
// What is left in THIS file is the state machine and the composition: what the editor knows, how
// a server answer becomes a green line or a red one, and which panel goes where. The panels are a
// module each (./CharacterGallery, ./CategoryPicker, ./GrantRow, ./FlagPicker, ./EditorChrome) and
// everything claimed about main-server is in ./characterCatalog, ./flagCatalog and
// ./serverRefusals, each naming the file/line it was read from on branch SurvivalMode
// (2026-08-05) so the next reader can re-check instead of trusting a comment.

import { useState } from 'react';
import type { ReactElement } from 'react';
import { Modal } from './Modal';
import { CategoryPicker } from './CategoryPicker';
import { CharacterGallery, CharacterPreview } from './CharacterGallery';
import { EditorFooter, EditorTabs } from './EditorChrome';
import { FlagPicker } from './FlagPicker';
import { GrantRow } from './GrantRow';
import { freshUi, withCategoryToggled, withCharacterSelected } from './editorModel';
import type { ApplyCharacter, EditorCurrent, EditorUi, Grant } from './editorModel';
import { errorHint } from './serverRefusals';
import { characterName } from '../gameAssets';
import './characterEditor.css';

export interface CharacterEditorProps {
  open: boolean;
  onClose: () => void;
  /** what the player looks like right now, as far as the client knows */
  current: EditorCurrent;
  /** non-null while a call is in flight; also the label to show */
  busy: string | null;
  /** beG.resetChar — throws with the server's message on refusal */
  onApplyCharacter: ApplyCharacter;
  /** beG.changeFlag */
  onApplyFlag: (flag: string) => Promise<void>;
  /** adminApi.grantToPlayer — testbed-only unlock */
  onGrant: Grant;
}

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
  // A reborn player picks 1 strong + 1 weak, everyone else 2 strong + 1 weak — resetChar
  // enforces exactly this count (lib/characters.js) and answers a wrong one through a
  // mistyped `api.beGenius.error`, which THROWS instead of replying: the tester would just
  // watch the call hang until the gateway's 15s timeout. So the picker must never be able to
  // build a selection the server will reject.
  const wantCategories = current.reborn ? 2 : 3;
  const missing = wantCategories - ui.categories.length;
  const ready = ui.categories.length === wantCategories;
  const canGrant = !!current.playerId;

  const characterTab = (
    <div className="ce-split">
      <CharacterGallery
        selected={ui.selected}
        worn={current.character}
        onSelect={(id) => setUi((u) => withCharacterSelected(u, id))}
      />
      <div className="ce-side">
        <CharacterPreview id={ui.selected} />
        <CategoryPicker
          categories={ui.categories}
          want={wantCategories}
          reborn={current.reborn}
          onToggle={(id) => setUi((u) => withCategoryToggled(u, id, wantCategories))}
        />
        <GrantRow
          locked={locked}
          canGrant={canGrant}
          selected={ui.selected}
          run={run}
          onGrant={onGrant}
        />
      </div>
    </div>
  );

  const flagTab = (
    <FlagPicker
      current={current.flag}
      search={ui.search}
      onSearch={(search) => patch({ search })}
      locked={locked}
      canGrant={canGrant}
      run={run}
      onApplyFlag={onApplyFlag}
      onGrant={onGrant}
    />
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
      footer={
        <EditorFooter
          ui={ui}
          busy={busy}
          locked={locked}
          ready={ready}
          missing={missing}
          run={run}
          onApplyCharacter={onApplyCharacter}
          onClose={onClose}
        />
      }
    >
      {/* `ce` scopes every override of a shared ui.css class to this screen — a bare `.ui-h span`
          rule here would silently restyle every other dialog built on the same kit. */}
      <div className="ui-stack ce">
        <EditorTabs tab={ui.tab} onTab={goTab} />

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
