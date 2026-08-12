// The two dialogs that only ASK: «Статус лобі» and «Ціна викупу».
//
// One file because they are one idea — a call, the handful of fields the client read out of the
// reply, and the reply itself underneath (RawJson and the shared prop shape live in
// InspectorShared). Neither changes anything on the server, and neither may take a decision the
// stage should be taking: the «Викупитись» button stays in the fight panel, this one only
// prices it.

import { Modal } from '../ui/Modal';
import { LOBBY_ENDED_TEXT, isLobbyEnded, reasonText, stepLabel } from '../survival';
import { RawJson, type InspectorDialogProps } from './InspectorShared';

/**
 * The reply's explicit "no lobby exists". Same three-way discipline as applyConnectReply: only
 * a PRESENT `lobbyId: null` is the server resolving «немає лоббі» — a missing field is an older
 * build saying nothing, and must keep showing the raw reply instead of claiming an empty world.
 */
const isNoLobbyReply = (reply: unknown): boolean =>
  !!reply &&
  typeof reply === 'object' &&
  'lobbyId' in reply &&
  (reply as { lobbyId: unknown }).lobbyId === null;

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
  // C3: a socket whose lobby ENDED answers EVERY RPC with «Lobby has ended» — a deliberate
  // scene-reset signal, not a failure, so it earns a state of its own instead of a raw error
  const ended = isLobbyEnded(dialogError);
  const noLobby = !ended && !!info && isNoLobbyReply(info.reply);
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
          {/* the «Lobby has ended» refusal is rendered as the body's own state below — repeating
              the raw prose here would present the contract signal as a second, English failure */}
          {dialogError && !ended && <span className="spread ui-note bad">{dialogError}</span>}
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
        {ended ? (
          <p className="ui-note warn">
            <b>Лоббі завершене.</b> {LOBBY_ENDED_TEXT} — сервер тепер відповідає{' '}
            <code>Lobby has ended</code> на КОЖЕН виклик цього сокета, поки клієнт не зайде
            заново («Зайти в Survival»).
          </p>
        ) : noLobby ? (
          <p className="ui-note warn">
            <b>Немає активного лоббі.</b> Сервер явно відповів <code>lobbyId: null</code> —
            усе лоббі-скоупне на екрані вже застаріле, реєструватись поки нема куди.
          </p>
        ) : info ? (
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
