// 1а. Реєстрація — the sign-up list itself. The dialog around it is BookingDialog,
// the row markup is BookingRoster.

import { MATCH_IN_PROGRESS_TEXT, type BookingStatus } from '../survival';
import { BookingRoster } from './BookingRoster';
import { humansBotsLabel } from './peopleWords';

/**
 * "через 3 год 12 хв". The match is scheduled hours ahead, so seconds are noise until the last
 * minutes; a start that has already passed says so rather than counting backwards.
 */
const untilText = (ms: number): string => {
  if (!Number.isFinite(ms)) return '';
  if (ms <= 0) return 'старт уже настав';
  const total = Math.round(ms / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (hours > 0) return `через ${hours} год ${minutes} хв`;
  if (minutes > 0) return `через ${minutes} хв ${total % 60} с`;
  return `через ${total} с`;
};

/**
 * 1а. Реєстрація — the booking popup exactly as the main menu draws it, long before the match.
 *
 * Everything on it comes from ONE beG.getSurvivalStatus reply, over the main-server connection,
 * with no survival session anywhere: that is the path this panel exists to prove. The roster is
 * rendered in the order it arrived (registration order) and numbered from the array index,
 * because `slot` is null for the whole of BOOKING — sorting it, filtering it or numbering it by
 * slot would all break the contract the server side documents.
 *
 * It is the BODY of a dialog now, not a panel on the stage: no frame of its own (the dialog is
 * the frame), no title and no «зареєстрований» pill (both live in the modal header), and no
 * button row (those are the modal footer, pinned under the scroll so a long roster cannot push
 * them out of reach).
 */
export function BookingBody({
  status,
  me,
  now,
}: {
  status: BookingStatus | null;
  me?: string;
  now: number;
}) {
  const lobby = status?.lobby ?? null;
  const roster = lobby?.roster ?? [];
  // playerCount is the server's own total (bots included). The roster length is only a fallback
  // for a reply that did not carry the count — the two agree in every normal answer.
  const total = lobby?.playerCount ?? roster.length;
  const startsAt = lobby?.scheduledStartAt ? Date.parse(lobby.scheduledStartAt) : NaN;

  return (
    <div className="booking in-modal">
      {!status ? (
        <p className="hint">
          Це той самий <code>beG.getSurvivalStatus</code>, яким головне меню показує список
          записаних задовго до матчу. Зʼєднання з survival-server для цього не потрібне —
          натисни «Оновити список» унизу.
        </p>
      ) : status.available === false ? (
        // available:false means survival-server did not answer main-server at all — a different
        // thing from "лоббі ще немає", so it gets its own words instead of an empty list.
        <p className="deny">
          Survival недоступний (<code>available: false</code>) — main-server не достукався до
          survival-server, тож реєстрації зараз немає взагалі.
        </p>
      ) : !lobby ? (
        <p className="deny">
          Активного лоббі немає (<code>lobby: null</code>) — записуватись поки нема куди.
          Наступне лоббі створюється за розкладом.
        </p>
      ) : (
        <>
          {/* C4: joinable=false while registered is ALSO false = a match is RUNNING right now —
              joinSurvival can only refuse, so this screen says why up front instead of letting
              the join button teach it through an error. Both checks are strict `=== false`:
              an older main-server that says neither must keep the legacy behaviour. */}
          {status.joinable === false && status.registered === false && (
            <p className="deny">
              {MATCH_IN_PROGRESS_TEXT} (<code>joinable: false</code>).
            </p>
          )}
          <div className="top">
            <div className="count">
              {/* C2: bots are in the roster from lobby open, so the bare total is mostly bots —
                  an unsplit «7 гравців» would be a claim about two humans */}
              <b>{total}</b> <span>зареєстровано — {humansBotsLabel(total, roster)}</span>
            </div>
            <div className="meta">
              <span>
                стан: <b>{lobby.state ?? '—'}</b>
              </span>
              {Number.isFinite(startsAt) && (
                <span>
                  старт: <b>{new Date(startsAt).toLocaleString()}</b>
                </span>
              )}
              {lobby.round !== undefined && lobby.round > 0 && (
                <span>
                  раунд: <b>{lobby.round}</b>
                </span>
              )}
              {status.entryCost !== undefined && <span>вхід: 🎟 {status.entryCost}</span>}
            </div>
          </div>

          {Number.isFinite(startsAt) && <p className="until">{untilText(startsAt - now)}</p>}

          <BookingRoster roster={roster} me={me} />

          {lobby.activePlayerCount !== undefined && lobby.activePlayerCount !== total && (
            <p className="answered">
              ще в грі: {lobby.activePlayerCount} з {total}
            </p>
          )}
        </>
      )}

      <p className="ui-note warn">
        «Створити клан», «Змінити прапор» і «Персонаж…» унизу — суто тестові кнопки, щоб колонки
        «клан», «прап.» і «перс.» не були однаковими в усіх рядках (мок-гравці заходять з
        localhost, тож геоip ставить усім 'UN'). Прапор ставиться справжнім{' '}
        <code>beG.changeFlag</code>, персонаж — справжнім <code>beG.resetChar</code>.
        <b> Клан, прапор і персонаж підставляються в ростер у момент реєстрації</b>, тож міняй їх
        ДО «Зайти в Survival» — інакше зміну буде видно лише в наступному лоббі.
      </p>
    </div>
  );
}
