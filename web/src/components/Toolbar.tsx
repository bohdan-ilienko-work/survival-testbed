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
  /** this tab holds a spectator seat — the one button that doubles as its re-sync */
  watching: boolean;
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
  /** main-server's own leave: gives the seat back without a survival session */
  onUnregister: () => void;
  onAd: () => void;
  /** one ticket for one ad, once a UTC day (main-server) */
  onAdTicket: () => void;
  onQuote: () => void;
  /** the mode's rules, in words — the same copy the client shows behind its Rules button */
  onRules: () => void;
  /** gems → tickets, the real purchase path */
  onBuyTickets: () => void;
  onWatch: () => void;
  onStopWatching: () => void;
}

export function Toolbar(p: ToolbarProps) {
  const { busy, gwOnline, playerId, step, watching } = p;
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
        <button onClick={p.onBuyTickets} disabled={!!busy || !playerId}>Купити 🎟</button>
        <button onClick={p.onAdTicket} disabled={!!busy || !playerId}>Реклама → 🎟</button>
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
        {/* Gated on nothing: the rules are just text, and they are most wanted before anybody
            has signed in or connected anything. */}
        <button onClick={p.onRules}>Правила</button>
        <button onClick={p.onLeave} disabled={!!busy || step === 'idle'}>Вийти</button>
        {/* Gated on the PLAYER, not on the step: the whole point is that it works before this
            tab has any survival session — which is where the seat used to survive. */}
        <button onClick={p.onUnregister} disabled={!!busy || !playerId}>
          Знятися з турніру
        </button>
      </ToolGroup>

      <ToolGroup label="Глядач">
        {/* Deliberately NOT gated on playerId: watching needs no account, no ticket and no
            beG.joinSurvival — that missing gate is the very thing this mode exists to prove.
            `survival.spectate` is idempotent per socket, so the same button is both the way in
            and the re-sync: a second call re-serves a fresh snapshot on the same seat. */}
        <button onClick={p.onWatch} disabled={!!busy || !gwOnline} className={watching ? '' : 'primary'}>
          {watching ? '↻ Оновити кадр' : '👁 Дивитись матч'}
        </button>
        <button onClick={p.onStopWatching} disabled={!!busy || !watching}>
          Досить дивитись
        </button>
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
