// The whole control panel: four intents instead of one undifferentiated row.
//
// Every `disabled` below is unchanged from the flat row it replaces: each one encodes a real
// precondition (note that «Хто зареєстрований» is deliberately NOT gated on the survival
// socket), so the grouping is a layout change and not a permission change.

import { useId } from 'react';
import type { ReactNode } from 'react';
import type { Step } from '../survival';

export interface ToolbarProps {
  busy: string | null;
  gwOnline: boolean;
  playerId?: string;
  step: Step;
  onStart: () => void;
  onConnectAll: () => void;
  /** @param fresh true = forget the stored account and get a brand new mock player */
  onMockUser: (fresh: boolean) => void;
  onCharacter: () => void;
  onGrantTickets: () => void;
  onRefreshTickets: () => void;
  onBooking: () => void;
  onJoin: () => void;
  onLobbyStatus: () => void;
  onLeave: () => void;
  onAd: () => void;
  onQuote: () => void;
}

export function Toolbar(p: ToolbarProps) {
  const { busy, gwOnline, playerId, step } = p;
  return (
    <section className="toolbar">
      <ToolGroup label="Стенд">
        <button onClick={p.onStart} disabled={!!busy || !gwOnline} className="primary big">
          ▶ Почати тест
        </button>
        <button onClick={p.onConnectAll} disabled={!!busy}>Підключити сервери</button>
      </ToolGroup>

      <ToolGroup label="Гравець">
        <button onClick={() => p.onMockUser(false)} disabled={!!busy || !gwOnline}>Мок-юзер</button>
        <button onClick={() => p.onMockUser(true)} disabled={!!busy || !gwOnline}>
          Новий гравець
        </button>
        {/* Gated on the player, not on the gateway: every call the editor makes goes to
            main-server's beG/adminApi, and beG's guard (`if (connection.player)`) simply never
            calls back for a tab that has not signed in — a 20 s timeout instead of an error. */}
        <button onClick={p.onCharacter} disabled={!!busy || !playerId}>
          Персонаж
        </button>
        <button onClick={p.onGrantTickets} disabled={!!busy || !playerId}>+50 🎟</button>
        <button onClick={p.onRefreshTickets} disabled={!!busy || !playerId}>Тікети</button>
      </ToolGroup>

      <ToolGroup label="Survival">
        {/* main-server only: this is the pre-match booking screen, so it must stay usable
            while survival is not connected — do not add a survival gate here */}
        <button onClick={p.onBooking} disabled={!!busy || !playerId}>
          Хто зареєстрований
        </button>
        <button onClick={p.onJoin} disabled={!!busy || !playerId} className="primary">
          Зайти в Survival
        </button>
        <button onClick={p.onLobbyStatus} disabled={!!busy}>Статус лобі</button>
        <button onClick={p.onLeave} disabled={!!busy || step === 'idle'}>Вийти</button>
      </ToolGroup>

      <ToolGroup label="У бою">
        <button onClick={p.onAd} disabled={!!busy || step === 'idle'}>
          Реклама +🎟
        </button>
        <button onClick={p.onQuote} disabled={!!busy || step === 'idle'}>
          Ціна викупу
        </button>
      </ToolGroup>

      {busy && <span className="busy">{busy}…</span>}
    </section>
  );
}

/**
 * One labelled cluster of toolbar buttons.
 *
 * The caption is the point: it says what the buttons under it are FOR, which is the one thing
 * the old flat row could not say. `role="group"` + aria-labelledby gives a screen reader the
 * same grouping the eye gets, instead of a dozen unrelated buttons in a row.
 */
function ToolGroup({ label, children }: { label: string; children: ReactNode }) {
  const id = useId();
  return (
    // These class names belong to App.css, which owns the whole toolbar block — including the
    // ≤720px rule that drops each group onto its own line. Renaming them here unstyles all of it
    // silently, which is exactly what happened while this file and the stylesheet were written
    // in parallel.
    <div className="tgroup" role="group" aria-labelledby={id}>
      <span className="tgroup-label" id={id}>
        {label}
      </span>
      <div className="tgroup-buttons">{children}</div>
    </div>
  );
}
