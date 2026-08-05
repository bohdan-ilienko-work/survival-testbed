// 1а. Реєстрація — the sign-up list itself. The dialog around it is BookingDialog.

import type { BookingStatus, LobbyPlayer } from '../survival';
import { CharacterImg, FlagImg } from './PlayerArt';

/** 1 гравець · 2 гравці · 5 гравців — this count is the headline, so it has to agree. */
const playersWord = (n: number): string => {
  const tens = n % 100;
  const ones = n % 10;
  if (ones === 1 && tens !== 11) return 'гравець';
  if (ones >= 2 && ones <= 4 && (tens < 12 || tens > 14)) return 'гравці';
  return 'гравців';
};

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
          <div className="top">
            <div className="count">
              <b>{total}</b> <span>{playersWord(total)} зареєстровано</span>
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

          {roster.length === 0 ? (
            <p className="hint">Ще ніхто не зареєструвався.</p>
          ) : (
            <div className="rosterbox">
              <div className="rhead">
                <span className="num">№</span>
                <span>прап.</span>
                <span>перс.</span>
                <span>гравець</span>
                <span className="tail">клан</span>
              </div>
              <ol className="roster">
                {roster.map((entry, index) => (
                  <RosterRow
                    // Registration order is the contract, so duplicates must NOT be collapsed:
                    // the index is what keeps the key unique even if the server ever repeats a
                    // playerId, and the row number below comes from that same index.
                    key={`${index}:${entry?.playerId ?? ''}`}
                    entry={entry}
                    index={index}
                    me={me}
                  />
                ))}
              </ol>
            </div>
          )}

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

/**
 * One booking row: number, flag, character, nickname, clan.
 * Each field is re-checked here rather than trusted: the roster is read straight off the wire
 * (see readBookingStatus, which only guarantees it is an array), so a row that is not an object
 * at all must render as a dash instead of taking the whole panel down with it.
 */
function RosterRow({ entry, index, me }: { entry: LobbyPlayer; index: number; me?: string }) {
  const row: LobbyPlayer = entry && typeof entry === 'object' ? entry : ({} as LobbyPlayer);
  const id = typeof row.playerId === 'string' ? row.playerId : '';
  const name = typeof row.name === 'string' ? row.name.trim() : '';
  // '' is the contracted value for "no clan" (bots always), so an empty column is a real answer
  const clan = typeof row.clan === 'string' ? row.clan.trim() : '';
  const mine = !!me && id === me;

  return (
    <li className={`${mine ? 'me' : ''} ${row.eliminated ? 'out' : ''}`}>
      {/* 1..N from the ARRAY INDEX: `slot` is null for the whole of BOOKING */}
      <span className="num">{index + 1}</span>
      {/* the same two components the aside roster uses — see PlayerArt */}
      <FlagImg flag={row.flag} />
      <CharacterImg id={row.character} />
      <span className="nick" title={id}>
        {name || (id ? id.slice(0, 12) : '—')}
      </span>
      <span className="tail">
        {clan && (
          <span className="clan" title="клан">
            {clan}
          </span>
        )}
        {row.isBot && <span className="bot">бот</span>}
        {mine && <span className="mine">я</span>}
      </span>
    </li>
  );
}
