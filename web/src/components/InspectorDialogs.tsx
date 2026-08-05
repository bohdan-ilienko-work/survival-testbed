// The two dialogs that only ASK: «Статус лобі» and «Ціна викупу».
//
// They are one file because they are one idea — a call, the handful of fields the client read
// out of the reply, and the reply itself underneath. Neither changes anything on the server, and
// neither may take a decision the stage should be taking: the «Викупитись» button stays in the
// fight panel, this one only prices it.

import { Modal } from '../ui/Modal';
import { reasonText, stepLabel, type SurvivalState } from '../survival';
import type { Snapshot } from '../hooks/types';

/**
 * A server reply, untouched.
 *
 * The whole reason a testbed exists is to see what actually came back, so the dialogs that ask
 * a question show the raw JSON next to the fields the UI read out of it — that is how a renamed
 * field is caught instead of silently rendering as «—».
 */
function RawJson({ value }: { value: unknown }) {
  return (
    <div className="ui-scroll-x">
      <pre className="raw-json">
        <code>{JSON.stringify(value, null, 2)}</code>
      </pre>
    </div>
  );
}

export interface InspectorDialogProps {
  open: boolean;
  onClose: () => void;
  busy: boolean;
  dialogError: string | null;
  onRefresh: () => void;
  info: Snapshot | null;
  state: SurvivalState;
}

export function LobbyStatusDialog({
  open,
  onClose,
  busy,
  dialogError,
  onRefresh,
  info,
  state,
  players,
  alive,
}: InspectorDialogProps & { players: number; alive: number }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      busy={busy}
      title="Статус лобі"
      subtitle={
        info
          ? `survival.getLobbyStatus · ${new Date(info.at).toLocaleTimeString()}`
          : 'survival.getLobbyStatus — питаємо survival-server напряму'
      }
      footer={
        <>
          {dialogError && <span className="spread ui-note bad">{dialogError}</span>}
          <button onClick={onRefresh} disabled={busy}>Оновити</button>
          <button className="primary" onClick={onClose} disabled={busy}>Закрити</button>
        </>
      }
    >
      <div className="ui-stack">
        <div className="ui-rows">
          <div className="ui-row"><span>лоббі</span><span><code>{state.lobbyId ?? '—'}</code></span></div>
          <div className="ui-row"><span>стан</span><span>{state.lobbyState ?? '—'}</span></div>
          <div className="ui-row"><span>крок клієнта</span><span>{stepLabel[state.step]}</span></div>
          <div className="ui-row"><span>у ростері</span><span>{players || '—'}</span></div>
          <div className="ui-row"><span>ще в грі</span><span>{alive}</span></div>
        </div>
        {/* The roster the reply carries is already adopted into state.players, so it is drawn
            by the aside on the right; repeating it here would be two lists that can disagree. */}
        {info ? (
          <div>
            <h3 className="ui-h">Відповідь сервера</h3>
            <RawJson value={info.reply} />
          </div>
        ) : (
          /* survival-server checks `connectedClients.get(connection)` and then boundLobby()
             (server.ts:832), so this call needs a socket already bound by survival.connect —
             say so instead of letting the tester read "Not authenticated" as a bug. */
          <p className="ui-sub">
            Ще не питали. Виклик іде прямо в survival-server і працює тільки для привʼязаного
            зʼєднання: без «Зайти в Survival» сервер відповість <code>Not authenticated</code>.
          </p>
        )}
      </div>
    </Modal>
  );
}

export function BuyBackQuoteDialog({
  open,
  onClose,
  busy,
  dialogError,
  onRefresh,
  info,
  state,
  now,
}: InspectorDialogProps & { now: number }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      busy={busy}
      title="Ціна викупу"
      subtitle={
        info
          ? `survival.getBuyBackQuote · ${new Date(info.at).toLocaleTimeString()}`
          : 'survival.getBuyBackQuote — приватна ціна саме для цього гравця'
      }
      footer={
        <>
          {dialogError && <span className="spread ui-note bad">{dialogError}</span>}
          <button onClick={onRefresh} disabled={busy}>Оновити ціну</button>
          <button className="primary" onClick={onClose} disabled={busy}>Закрити</button>
        </>
      }
    >
      <div className="ui-stack">
        <div className="ui-rows">
          <div className="ui-row">
            <span>ціна цієї спроби</span>
            <span>{state.buybackCost === undefined ? '—' : `🎟 ${state.buybackCost}`}</span>
          </div>
          <div className="ui-row">
            <span>спроба</span>
            <span>
              {state.buybackAttempt ?? '—'} / {state.buybackMaxUses ?? '—'}
            </span>
          </div>
          <div className="ui-row"><span>твій баланс</span><span>🎟 {state.tickets ?? '—'}</span></div>
          <div className="ui-row">
            <span>по кишені</span>
            <span>
              {state.buybackAffordable === undefined
                ? 'сервер не сказав'
                : state.buybackAffordable
                  ? 'так'
                  : 'ні'}
            </span>
          </div>
          <div className="ui-row">
            <span>вікно закриється</span>
            <span>
              {state.buybackClosesAt === undefined
                ? '—'
                : `через ${Math.max(0, Math.ceil((state.buybackClosesAt - now) / 1000))} с`}
            </span>
          </div>
          {state.buybackUnavailableReason && (
            <div className="ui-row">
              <span>недоступно</span>
              <span title={state.buybackUnavailableReason}>
                {reasonText(state.buybackUnavailableReason)}
              </span>
            </div>
          )}
        </div>
        {/* Викуп сам по собі лишився на сцені — це частина бою і не ховається в діалог. */}
        <p className="ui-note">
          Ціна приватна: сервер шле її подією <b>buyBackOffer</b> у момент відкриття вікна, а
          цей виклик — спосіб дізнатись її, якщо вкладка перепідключилась і подію проґавила.
          Сама кнопка «Викупитись» лишається на сцені, у панелі бою.
        </p>
        {info && (
          <div>
            <h3 className="ui-h">Відповідь сервера</h3>
            <RawJson value={info.reply} />
          </div>
        )}
      </div>
    </Modal>
  );
}
